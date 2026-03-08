create table if not exists public.navlungo_connections (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  client_id text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  connected_email text,
  connected_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint navlungo_connections_environment_check check (environment in ('qa', 'prod'))
);

create unique index if not exists idx_navlungo_connections_environment_unique
  on public.navlungo_connections(environment);

alter table public.navlungo_connections enable row level security;
