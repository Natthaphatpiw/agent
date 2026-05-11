create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_number text not null unique,
  email text unique,
  address text,
  membership_status text not null default 'active'
    check (membership_status in ('active', 'paused', 'cancelled')),
  security_question text not null,
  security_answer_hash text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

create index if not exists customers_full_name_trgm_idx
  on public.customers using gin (lower(full_name) gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

create or replace function public.normalize_phone(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(value, ''), '\D', '', 'g');
$$;

create or replace function public.mask_phone(value text)
returns text
language sql
stable
as $$
  select case
    when public.normalize_phone(value) = '' then null
    when length(public.normalize_phone(value)) <= 4 then repeat('*', length(public.normalize_phone(value)))
    else repeat('*', greatest(length(public.normalize_phone(value)) - 4, 0))
      || right(public.normalize_phone(value), 4)
  end;
$$;

create or replace function public.search_customers(query_text text, limit_count int default 5)
returns table (
  customer_id uuid,
  full_name text,
  masked_phone text,
  membership_status text,
  security_question text,
  similarity_score real,
  is_likely_match boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      c.id,
      c.full_name,
      public.mask_phone(c.phone_number) as masked_phone,
      c.membership_status,
      c.security_question,
      greatest(
        similarity(lower(c.full_name), lower(trim(query_text))),
        similarity(lower(split_part(c.full_name, ' ', 1)), lower(trim(query_text)))
      ) as score,
      (
        lower(c.full_name) like '%' || lower(trim(query_text)) || '%'
        or lower(split_part(c.full_name, ' ', 1)) = lower(trim(query_text))
      ) as direct_match
    from public.customers c
    where coalesce(trim(query_text), '') <> ''
  )
  select
    id,
    full_name,
    masked_phone,
    membership_status,
    security_question,
    score,
    (direct_match or score >= 0.35) as is_likely_match
  from scored
  order by (direct_match or score >= 0.35) desc, score desc, full_name asc
  limit greatest(1, least(coalesce(limit_count, 5), 10));
$$;

create or replace function public.verify_customer_secret(
  customer_uuid uuid,
  phone_number_input text,
  security_answer_input text
)
returns table (
  verified boolean,
  reason text,
  customer_id uuid,
  full_name text,
  masked_phone text,
  membership_status text,
  security_question text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  customer_row public.customers%rowtype;
begin
  select * into customer_row
  from public.customers
  where id = customer_uuid;

  if not found then
    return query select false, 'customer_not_found', null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;

  if public.normalize_phone(customer_row.phone_number) <> public.normalize_phone(phone_number_input) then
    return query select
      false,
      'phone_mismatch',
      customer_row.id,
      customer_row.full_name,
      public.mask_phone(customer_row.phone_number),
      customer_row.membership_status,
      customer_row.security_question;
    return;
  end if;

  if extensions.crypt(lower(trim(security_answer_input)), customer_row.security_answer_hash) <> customer_row.security_answer_hash then
    return query select
      false,
      'security_answer_mismatch',
      customer_row.id,
      customer_row.full_name,
      public.mask_phone(customer_row.phone_number),
      customer_row.membership_status,
      customer_row.security_question;
    return;
  end if;

  return query select
    true,
    'verified',
    customer_row.id,
    customer_row.full_name,
    public.mask_phone(customer_row.phone_number),
    customer_row.membership_status,
    customer_row.security_question;
end;
$$;

create or replace function public.register_customer(
  full_name_input text,
  phone_number_input text,
  email_input text default null,
  address_input text default null,
  security_question_input text default 'คำถามยืนยันตัวตนของคุณคืออะไร',
  security_answer_input text default null,
  notes_input text default null
)
returns table (
  customer_id uuid,
  full_name text,
  masked_phone text,
  email text,
  address text,
  membership_status text,
  security_question text,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(security_answer_input), '') = '' then
    raise exception 'security_answer_input is required';
  end if;

  return query
  insert into public.customers (
    full_name,
    phone_number,
    email,
    address,
    security_question,
    security_answer_hash,
    notes
  )
  values (
    trim(full_name_input),
    trim(phone_number_input),
    nullif(trim(coalesce(email_input, '')), ''),
    nullif(trim(coalesce(address_input, '')), ''),
    trim(security_question_input),
    extensions.crypt(lower(trim(security_answer_input)), extensions.gen_salt('bf')),
    nullif(trim(coalesce(notes_input, '')), '')
  )
  returning
    id,
    customers.full_name,
    public.mask_phone(customers.phone_number),
    customers.email,
    customers.address,
    customers.membership_status,
    customers.security_question,
    customers.notes,
    customers.created_at;
end;
$$;

grant usage on schema public to service_role;
grant select, insert, update on public.customers to service_role;
grant execute on function public.search_customers(text, int) to service_role;
grant execute on function public.verify_customer_secret(uuid, text, text) to service_role;
grant execute on function public.register_customer(text, text, text, text, text, text, text) to service_role;

insert into public.customers (
  full_name,
  phone_number,
  email,
  address,
  security_question,
  security_answer_hash,
  notes
)
values
  (
    'อนงค์ ใจดี',
    '0812345678',
    'anong@example.com',
    'กรุงเทพมหานคร',
    'สัตว์เลี้ยงตัวแรกของคุณชื่ออะไร',
    extensions.crypt('pony', extensions.gen_salt('bf')),
    'Mock customer for successful lookup and verification flow'
  ),
  (
    'อเนก สุขใจ',
    '0895551234',
    'anek@example.com',
    'เชียงใหม่',
    'โรงเรียนประถมของคุณชื่ออะไร',
    extensions.crypt('banmai', extensions.gen_salt('bf')),
    'Mock customer for near-name suggestion flow'
  ),
  (
    'Anong Carter',
    '+66815550000',
    'anong.carter@example.com',
    'Phuket',
    'What city were you born in?',
    extensions.crypt('bangkok', extensions.gen_salt('bf')),
    'English-name mock customer'
  )
on conflict (phone_number) do nothing;
