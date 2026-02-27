alter table if exists public.orders
  add column if not exists receiver_name text,
  add column if not exists receiver_phone text,
  add column if not exists receiver_country_code text,
  add column if not exists receiver_state text,
  add column if not exists receiver_city text,
  add column if not exists receiver_town text,
  add column if not exists receiver_postal_code text,
  add column if not exists navlungo_status text,
  add column if not exists navlungo_error text,
  add column if not exists navlungo_store_id text,
  add column if not exists navlungo_search_id text,
  add column if not exists navlungo_quote_reference text,
  add column if not exists navlungo_shipment_id text,
  add column if not exists navlungo_shipment_reference text,
  add column if not exists navlungo_tracking_url text,
  add column if not exists navlungo_response jsonb,
  add column if not exists navlungo_last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_navlungo_status_check'
  ) then
    alter table public.orders
      add constraint orders_navlungo_status_check
      check (
        navlungo_status is null
        or navlungo_status in ('shipment_started', 'quote_failed', 'shipment_failed', 'failed', 'skipped')
      );
  end if;
end $$;

create index if not exists idx_orders_navlungo_status
  on public.orders(navlungo_status);

create index if not exists idx_orders_navlungo_shipment_id
  on public.orders(navlungo_shipment_id);

alter table if exists public.stores
  add column if not exists navlungo_store_id text;

create index if not exists idx_stores_navlungo_store_id
  on public.stores(navlungo_store_id);
