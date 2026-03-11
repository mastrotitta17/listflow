create table if not exists public.etsy_connections (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'prod',
  client_id text not null,
  etsy_user_id text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  token_type text,
  connected_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint etsy_connections_environment_check check (environment in ('prod'))
);

create unique index if not exists idx_etsy_connections_environment_unique
  on public.etsy_connections(environment);

alter table public.etsy_connections enable row level security;
