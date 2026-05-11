create extension if not exists pgcrypto;

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web', 'line')),
  actor_id text not null,
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  agent_session_id text not null unique,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 minutes',
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create index if not exists chat_sessions_actor_active_idx
on public.chat_sessions(channel, actor_id, status, expires_at);
