alter table if exists public.orders
  add column if not exists shipment_status text,
  add column if not exists shipment_error text,
  add column if not exists shipment_provider text,
  add column if not exists shipment_external_order_id text,
  add column if not exists shipment_tracking_number text,
  add column if not exists shipment_label_url text,
  add column if not exists shipment_invoice_url text,
  add column if not exists shipment_response jsonb,
  add column if not exists shipment_last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_shipment_status_check'
  ) then
    alter table public.orders
      add constraint orders_shipment_status_check
      check (
        shipment_status is null
        or shipment_status in ('shipment_started', 'order_create_failed', 'shipment_failed', 'failed', 'skipped')
      );
  end if;
end $$;

create index if not exists idx_orders_shipment_status
  on public.orders(shipment_status);

create index if not exists idx_orders_shipment_external_order_id
  on public.orders(shipment_external_order_id);

update public.orders
set
  shipment_status = coalesce(
    shipment_status,
    case
      when navlungo_status = 'quote_failed' then 'order_create_failed'
      when navlungo_status = 'failed' then 'shipment_failed'
      else navlungo_status
    end
  ),
  shipment_error = coalesce(shipment_error, navlungo_error),
  shipment_external_order_id = coalesce(shipment_external_order_id, navlungo_search_id, navlungo_shipment_id),
  shipment_tracking_number = coalesce(shipment_tracking_number, navlungo_shipment_reference),
  shipment_label_url = coalesce(shipment_label_url, navlungo_tracking_url),
  shipment_response = coalesce(shipment_response, navlungo_response),
  shipment_last_synced_at = coalesce(shipment_last_synced_at, navlungo_last_synced_at),
  shipment_provider = coalesce(
    shipment_provider,
    case
      when navlungo_status is not null then 'shipentegra'
      else shipment_provider
    end
  )
where
  shipment_status is null
  or shipment_error is null
  or shipment_external_order_id is null
  or shipment_tracking_number is null
  or shipment_label_url is null
  or shipment_response is null
  or shipment_last_synced_at is null
  or shipment_provider is null;
