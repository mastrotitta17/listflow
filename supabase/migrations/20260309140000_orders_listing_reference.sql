alter table if exists public.orders
  add column if not exists listing_id text,
  add column if not exists listing_key text,
  add column if not exists listing_title text,
  add column if not exists listing_image_url text;

create index if not exists idx_orders_listing_id
  on public.orders(listing_id);
