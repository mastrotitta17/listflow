-- ============================================================
-- Referral System Tables
-- ============================================================

-- referral_codes: one per user, unique shareable code
create table if not exists public.referral_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;

create policy "referral_codes_own_read" on public.referral_codes
  for select using (auth.uid() = user_id);

create policy "referral_codes_own_insert" on public.referral_codes
  for insert with check (auth.uid() = user_id);

-- referral_conversions: tracks every signup that came via a referral code
create table if not exists public.referral_conversions (
  id                uuid primary key default gen_random_uuid(),
  referral_code     text not null,
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  referred_user_id  uuid references auth.users(id) on delete set null,
  signed_up_at      timestamptz not null default now(),
  subscribed_at     timestamptz,
  subscription_id   uuid,
  status            text not null default 'pending'
                    check (status in ('pending', 'qualified')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.referral_conversions enable row level security;

create policy "referral_conversions_referrer_read" on public.referral_conversions
  for select using (auth.uid() = referrer_user_id);

create policy "referral_conversions_referred_read" on public.referral_conversions
  for select using (auth.uid() = referred_user_id);

-- referral_rewards: issued when referrer hits milestones (5 or 10 qualified)
create table if not exists public.referral_rewards (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  reward_type               text not null
                            check (reward_type in ('discount_20pct', 'cash_250')),
  milestone                 integer not null,
  stripe_coupon_id          text,
  stripe_promotion_code_id  text,
  promo_code                text,
  status                    text not null default 'pending'
                            check (status in ('pending', 'issued', 'applied', 'expired')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.referral_rewards enable row level security;

create policy "referral_rewards_own_read" on public.referral_rewards
  for select using (auth.uid() = user_id);

-- Indexes
create index if not exists idx_referral_codes_user_id
  on public.referral_codes(user_id);

create index if not exists idx_referral_codes_code
  on public.referral_codes(code);

create index if not exists idx_referral_conversions_referrer
  on public.referral_conversions(referrer_user_id);

create index if not exists idx_referral_conversions_code
  on public.referral_conversions(referral_code);

create index if not exists idx_referral_conversions_referred_user
  on public.referral_conversions(referred_user_id);

create index if not exists idx_referral_rewards_user_id
  on public.referral_rewards(user_id);
