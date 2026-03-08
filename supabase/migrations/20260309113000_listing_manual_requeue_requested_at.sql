alter table if exists public.listing
  add column if not exists manual_requeue_requested_at timestamptz;
