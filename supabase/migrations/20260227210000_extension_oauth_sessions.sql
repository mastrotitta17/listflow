create table if not exists public.extension_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ext_oauth_sessions_key_idx on public.extension_oauth_sessions(session_key);
create index if not exists ext_oauth_sessions_expires_idx on public.extension_oauth_sessions(expires_at);

alter table public.extension_oauth_sessions enable row level security;

create policy "service_role_all_ext_oauth_sessions"
  on public.extension_oauth_sessions
  for all
  to service_role
  using (true)
  with check (true);
