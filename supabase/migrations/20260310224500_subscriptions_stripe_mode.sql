alter table if exists public.subscriptions
  add column if not exists stripe_mode text;

create index if not exists idx_subscriptions_stripe_mode
  on public.subscriptions (stripe_mode);

