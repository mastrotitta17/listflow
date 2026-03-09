create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  expo_push_token text not null,
  platform text not null,
  device_name text null,
  device_model text null,
  os_name text null,
  os_version text null,
  app_version text null,
  app_build text null,
  app_id text null,
  project_id text null,
  locale text null,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists mobile_push_tokens_expo_push_token_key
  on public.mobile_push_tokens (expo_push_token);

create index if not exists mobile_push_tokens_user_id_idx
  on public.mobile_push_tokens (user_id);

create index if not exists mobile_push_tokens_is_active_idx
  on public.mobile_push_tokens (is_active);

create table if not exists public.mobile_push_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  audience text not null default 'all',
  title text not null,
  body text not null,
  deeplink_url text null,
  payload jsonb not null default '{}'::jsonb,
  requested_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  response jsonb null
);

create index if not exists mobile_push_messages_created_at_idx
  on public.mobile_push_messages (created_at desc);
