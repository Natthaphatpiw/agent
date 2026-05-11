create extension if not exists pgcrypto;

create or replace function public.register_customer(
  full_name_input text,
  phone_number_input text,
  email_input text default null,
  address_input text default null,
  security_question_input text default null,
  security_answer_input text default null,
  notes_input text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_customer public.customers;
begin
  if nullif(trim(full_name_input), '') is null then
    raise exception 'full_name is required';
  end if;

  if nullif(trim(phone_number_input), '') is null then
    raise exception 'phone_number is required';
  end if;

  if nullif(trim(security_question_input), '') is null then
    raise exception 'security_question is required';
  end if;

  if nullif(trim(security_answer_input), '') is null then
    raise exception 'security_answer is required';
  end if;

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
    nullif(trim(email_input), ''),
    nullif(trim(address_input), ''),
    trim(security_question_input),
    crypt(security_answer_input, gen_salt('bf')),
    nullif(trim(notes_input), '')
  )
  returning * into inserted_customer;

  return inserted_customer;
end;
$$;

revoke all on function public.register_customer(text, text, text, text, text, text, text) from public;
grant execute on function public.register_customer(text, text, text, text, text, text, text) to service_role;
