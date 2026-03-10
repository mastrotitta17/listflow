alter function public.sync_listflow_pg_cron_scheduler(text, text, boolean)
rename to sync_listflow_pg_cron_scheduler_impl;

create or replace function public.sync_listflow_pg_cron_scheduler(
  p_cron_secret text,
  p_enabled boolean,
  p_scheduler_base_url text
)
returns jsonb
language sql
security definer
set search_path = public, private, cron
as $$
  select public.sync_listflow_pg_cron_scheduler_impl(
    p_scheduler_base_url,
    p_cron_secret,
    p_enabled
  );
$$;

grant execute on function public.sync_listflow_pg_cron_scheduler(text, boolean, text) to authenticated, service_role;
