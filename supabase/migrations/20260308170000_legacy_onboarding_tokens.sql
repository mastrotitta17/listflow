create table if not exists public.legacy_onboarding_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz
);

create index if not exists legacy_onboarding_tokens_user_id_idx
  on public.legacy_onboarding_tokens(user_id);

create index if not exists legacy_onboarding_tokens_active_user_idx
  on public.legacy_onboarding_tokens(user_id, created_at desc)
  where consumed_at is null;

create index if not exists legacy_onboarding_tokens_created_at_idx
  on public.legacy_onboarding_tokens(created_at desc);

alter table public.legacy_onboarding_tokens enable row level security;

create policy "service_role_all_legacy_onboarding_tokens"
  on public.legacy_onboarding_tokens
  for all
  to service_role
  using (true)
  with check (true);
