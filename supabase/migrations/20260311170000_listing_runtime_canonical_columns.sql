alter table if exists public.listing
  add column if not exists store_id text,
  add column if not exists listing_status text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id text,
  add column if not exists claimed_by text,
  add column if not exists completed_at timestamptz,
  add column if not exists etsy_listing_id text,
  add column if not exists etsy_listing_url text,
  add column if not exists publish_proof text,
  add column if not exists last_error text;
