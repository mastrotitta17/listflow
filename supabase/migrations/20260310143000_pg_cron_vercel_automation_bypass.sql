alter table private.listflow_scheduler_runtime_config
add column if not exists vercel_automation_bypass_secret text;

create or replace function public.listflow_pg_cron_dispatch()
returns bigint
language plpgsql
security definer
set search_path = public, private, cron, net
as $$
declare
  cfg private.listflow_scheduler_runtime_config%rowtype;
  v_request_id bigint;
  v_target_url text;
  v_headers jsonb;
begin
  select *
  into cfg
  from private.listflow_scheduler_runtime_config
  where id = 1;

  if not found or coalesce(cfg.enabled, false) = false then
    return null;
  end if;

  if coalesce(trim(cfg.scheduler_base_url), '') = '' or coalesce(trim(cfg.cron_secret), '') = '' then
    return null;
  end if;

  v_target_url := regexp_replace(trim(cfg.scheduler_base_url), '/+$', '') || '/api/scheduler/tick';

  v_headers := jsonb_build_object(
    'authorization', 'Bearer ' || cfg.cron_secret,
    'x-cron-secret', cfg.cron_secret,
    'x-listflow-tick-source', 'pg_cron',
    'content-type', 'application/json'
  );

  if coalesce(trim(cfg.vercel_automation_bypass_secret), '') <> '' then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', trim(cfg.vercel_automation_bypass_secret),
      'x-vercel-set-bypass-cookie', 'samesitenone'
    );
  end if;

  select net.http_post(
    url := v_target_url,
    headers := v_headers,
    body := '{}'::jsonb
  )
  into v_request_id;

  update private.listflow_scheduler_runtime_config
  set
    last_request_id = v_request_id,
    last_request_queued_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = 1;

  return v_request_id;
end;
$$;

create or replace function public.set_listflow_pg_cron_vercel_bypass_secret(
  p_vercel_bypass_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  normalized_secret text;
begin
  normalized_secret := nullif(trim(coalesce(p_vercel_bypass_secret, '')), '');

  insert into private.listflow_scheduler_runtime_config (
    id,
    vercel_automation_bypass_secret,
    last_synced_at,
    updated_at
  )
  values (
    1,
    normalized_secret,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
  set
    vercel_automation_bypass_secret = excluded.vercel_automation_bypass_secret,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'configured', normalized_secret is not null,
    'message',
      case
        when normalized_secret is null then 'Vercel automation bypass secret temizlendi.'
        else 'Vercel automation bypass secret senkronize edildi.'
      end
  );
end;
$$;

create or replace function public.get_listflow_pg_cron_scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  cfg private.listflow_scheduler_runtime_config%rowtype;
  existing_job record;
  latest_run record;
begin
  select *
  into cfg
  from private.listflow_scheduler_runtime_config
  where id = 1;

  select jobid, active, schedule, command
  into existing_job
  from cron.job
  where jobname = public.listflow_pg_cron_job_name()
  order by jobid asc
  limit 1;

  if existing_job.jobid is not null then
    select status, return_message, start_time, end_time
    into latest_run
    from cron.job_run_details
    where jobid = existing_job.jobid
    order by start_time desc
    limit 1;
  end if;

  return jsonb_build_object(
    'configured', cfg.id is not null,
    'enabled', coalesce(cfg.enabled, false),
    'schedulerBaseUrl', cfg.scheduler_base_url,
    'hasVercelBypassSecret', coalesce(trim(cfg.vercel_automation_bypass_secret), '') <> '',
    'jobId', existing_job.jobid,
    'active', coalesce(existing_job.active, false),
    'schedule', existing_job.schedule,
    'command', existing_job.command,
    'lastRunStatus', latest_run.status,
    'lastRunDetails', latest_run.return_message,
    'lastRunStartedAt', latest_run.start_time,
    'lastRunEndedAt', latest_run.end_time,
    'lastRequestId', cfg.last_request_id,
    'lastRequestQueuedAt', cfg.last_request_queued_at,
    'lastSyncedAt', cfg.last_synced_at
  );
end;
$$;

grant execute on function public.set_listflow_pg_cron_vercel_bypass_secret(text) to authenticated, service_role;
