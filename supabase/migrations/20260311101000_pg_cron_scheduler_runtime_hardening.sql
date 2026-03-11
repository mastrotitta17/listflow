create or replace function public.sync_listflow_pg_cron_scheduler_impl(
  p_scheduler_base_url text,
  p_cron_secret text,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  normalized_base_url text;
  normalized_secret text;
  existing_cfg private.listflow_scheduler_runtime_config%rowtype;
  next_scheduler_base_url text;
  next_cron_secret text;
  ensured_job_id bigint;
begin
  normalized_base_url := regexp_replace(coalesce(trim(p_scheduler_base_url), ''), '/+$', '');
  normalized_secret := coalesce(trim(p_cron_secret), '');

  select *
  into existing_cfg
  from private.listflow_scheduler_runtime_config
  where id = 1;

  next_scheduler_base_url := nullif(normalized_base_url, '');
  if next_scheduler_base_url is null then
    next_scheduler_base_url := existing_cfg.scheduler_base_url;
  end if;

  next_cron_secret := nullif(normalized_secret, '');
  if next_cron_secret is null then
    next_cron_secret := existing_cfg.cron_secret;
  end if;

  insert into private.listflow_scheduler_runtime_config (
    id,
    scheduler_base_url,
    cron_secret,
    enabled,
    last_synced_at,
    updated_at
  )
  values (
    1,
    next_scheduler_base_url,
    next_cron_secret,
    coalesce(p_enabled, true),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
  set
    scheduler_base_url = coalesce(excluded.scheduler_base_url, private.listflow_scheduler_runtime_config.scheduler_base_url),
    cron_secret = coalesce(excluded.cron_secret, private.listflow_scheduler_runtime_config.cron_secret),
    enabled = excluded.enabled,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at;

  if coalesce(p_enabled, true) then
    ensured_job_id := public.ensure_listflow_pg_cron_scheduler();

    return jsonb_build_object(
      'ok', true,
      'status', 'updated',
      'jobId', ensured_job_id,
      'message', 'Supabase pg_cron scheduler senkronize edildi.'
    );
  end if;

  perform public.disable_listflow_pg_cron_scheduler();

  return jsonb_build_object(
    'ok', true,
    'status', 'deleted',
    'jobId', null,
    'message', 'Supabase pg_cron scheduler devre dışı bırakıldı.'
  );
end;
$$;

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

grant execute on function public.sync_listflow_pg_cron_scheduler_impl(text, text, boolean) to authenticated, service_role;
grant execute on function public.sync_listflow_pg_cron_scheduler(text, boolean, text) to authenticated, service_role;
