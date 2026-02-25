-- Purpose:
-- Restore public schema table set to this repository baseline.
-- It removes any extra tables added later (including public.listing if present).
--
-- Safe usage:
-- 1) Run the DRY-RUN query first.
-- 2) Verify the list.
-- 3) Run the EXECUTE block.

-- =========================
-- DRY-RUN (no changes)
-- =========================
select tablename
from pg_tables
where schemaname = 'public'
  and tablename not in (
    'profiles',
    'categories',
    'products',
    'subscriptions',
    'payments',
    'webhook_configs',
    'webhook_logs',
    'stripe_event_logs',
    'scheduler_jobs',
    'stores',
    'stripe_plan_prices',
    'orders'
  )
order by tablename;

-- =========================
-- EXECUTE ROLLBACK
-- =========================
begin;

do $$
declare
  rec record;
begin
  for rec in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in (
        'profiles',
        'categories',
        'products',
        'subscriptions',
        'payments',
        'webhook_configs',
        'webhook_logs',
        'stripe_event_logs',
        'scheduler_jobs',
        'stores',
        'stripe_plan_prices',
        'orders'
      )
    order by tablename
  loop
    execute format('drop table if exists public.%I cascade', rec.tablename);
  end loop;
end
$$;

-- Cleanup possible leftover helper functions from experimental SQL runs.
drop function if exists public.set_listing_updated_at() cascade;
drop function if exists public.sync_products_excel_ingestion_fields() cascade;

commit;
