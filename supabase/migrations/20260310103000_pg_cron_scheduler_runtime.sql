create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;

create table if not exists private.listflow_scheduler_runtime_config (
  id smallint primary key default 1 check (id = 1),
  scheduler_base_url text,
  cron_secret text,
  enabled boolean not null default true,
  dispatch_schedule text not null default '* * * * *',
  last_request_id bigint,
  last_request_queued_at timestamptz,
  last_synced_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into private.listflow_scheduler_runtime_config (id, enabled)
values (1, true)
on conflict (id) do nothing;

revoke all on schema private from public;
revoke all on table private.listflow_scheduler_runtime_config from public;

create or replace function public.listflow_pg_cron_job_name()
returns text
language sql
stable
as $$
  select 'listflow_master_scheduler';
$$;

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

  select net.http_post(
    url := v_target_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || cfg.cron_secret,
      'x-cron-secret', cfg.cron_secret,
      'x-listflow-tick-source', 'pg_cron',
      'content-type', 'application/json'
    ),
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

create or replace function public.disable_listflow_pg_cron_scheduler()
returns void
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = public.listflow_pg_cron_job_name()
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

create or replace function public.ensure_listflow_pg_cron_scheduler()
returns bigint
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  existing_job record;
  selected_job_id bigint;
  expected_schedule text := '* * * * *';
  expected_command text := 'select public.listflow_pg_cron_dispatch();';
begin
  for existing_job in
    select jobid, schedule, command, active
    from cron.job
    where jobname = public.listflow_pg_cron_job_name()
    order by jobid asc
  loop
    if selected_job_id is null then
      if
        coalesce(existing_job.active, false) = true and
        coalesce(existing_job.schedule, '') = expected_schedule and
        btrim(coalesce(existing_job.command, '')) = expected_command
      then
        selected_job_id := existing_job.jobid;
      else
        perform cron.unschedule(existing_job.jobid);
      end if;
    else
      perform cron.unschedule(existing_job.jobid);
    end if;
  end loop;

  if selected_job_id is null then
    select cron.schedule(
      public.listflow_pg_cron_job_name(),
      expected_schedule,
      expected_command
    )
    into selected_job_id;
  end if;

  return selected_job_id;
end;
$$;

create or replace function public.sync_listflow_pg_cron_scheduler(
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
  ensured_job_id bigint;
begin
  normalized_base_url := regexp_replace(coalesce(trim(p_scheduler_base_url), ''), '/+$', '');
  normalized_secret := coalesce(trim(p_cron_secret), '');

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
    nullif(normalized_base_url, ''),
    nullif(normalized_secret, ''),
    coalesce(p_enabled, true),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
  set
    scheduler_base_url = excluded.scheduler_base_url,
    cron_secret = excluded.cron_secret,
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

grant execute on function public.listflow_pg_cron_dispatch() to authenticated, service_role;
grant execute on function public.disable_listflow_pg_cron_scheduler() to authenticated, service_role;
grant execute on function public.ensure_listflow_pg_cron_scheduler() to authenticated, service_role;
grant execute on function public.sync_listflow_pg_cron_scheduler(text, text, boolean) to authenticated, service_role;
grant execute on function public.get_listflow_pg_cron_scheduler_status() to authenticated, service_role;

select public.ensure_listflow_pg_cron_scheduler();
