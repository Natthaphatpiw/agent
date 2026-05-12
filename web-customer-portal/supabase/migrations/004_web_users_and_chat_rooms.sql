create extension if not exists pgcrypto;

create table if not exists public.web_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.authenticate_web_user(
  username_input text,
  password_input text
)
returns table (
  id uuid,
  username text,
  display_name text
)
language sql
security definer
set search_path = public
as $$
  select web_users.id, web_users.username, web_users.display_name
  from public.web_users
  where lower(web_users.username) = lower(trim(username_input))
    and web_users.is_active = true
    and web_users.password_hash = crypt(password_input, web_users.password_hash)
  limit 1;
$$;

revoke all on function public.authenticate_web_user(text, text) from public;
grant execute on function public.authenticate_web_user(text, text) to service_role;

insert into public.web_users (username, password_hash, display_name)
values (
  'demo',
  crypt('AgentCareDemo!2026', gen_salt('bf')),
  'Demo Member'
)
on conflict (username) do update
set display_name = excluded.display_name,
    is_active = true,
    updated_at = now();

create table if not exists public.web_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.web_users(id) on delete cascade,
  title text not null default 'บทสนทนาใหม่',
  agent_session_id text not null unique,
  status text not null default 'active' check (status in ('active', 'ended', 'deleted')),
  forked_from_room_id uuid null references public.web_chat_rooms(id) on delete set null,
  forked_from_message_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists web_chat_rooms_user_recent_idx
on public.web_chat_rooms(user_id, status, last_message_at desc);

create table if not exists public.web_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.web_chat_rooms(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  edited_from_message_id uuid null references public.web_chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz null
);

create index if not exists web_chat_messages_room_created_idx
on public.web_chat_messages(room_id, created_at, id);

