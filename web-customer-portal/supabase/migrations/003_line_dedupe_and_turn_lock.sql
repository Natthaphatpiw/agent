alter table public.chat_sessions
add column if not exists turn_status text not null default 'idle',
add column if not exists locked_until timestamptz null;

do $$
begin
  alter table public.chat_sessions
  add constraint chat_sessions_turn_status_check
  check (turn_status in ('idle', 'debouncing', 'processing'));
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.line_webhook_events (
  line_message_id text primary key,
  line_user_id text not null,
  chat_session_id uuid null references public.chat_sessions(id) on delete set null,
  agent_session_id text not null,
  reply_token text not null,
  message_text text not null,
  status text not null default 'received' check (
    status in ('received', 'processing', 'processed', 'dropped')
  ),
  created_at timestamptz not null default now(),
  processed_at timestamptz null
);

create index if not exists line_webhook_events_session_status_idx
on public.line_webhook_events(chat_session_id, line_user_id, status, created_at);

