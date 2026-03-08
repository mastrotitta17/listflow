create index if not exists extension_logs_event_idx
  on public.extension_logs(event);

create index if not exists extension_logs_event_store_listing_idx
  on public.extension_logs(event, store_id, ((metadata->>'listing_id')));
