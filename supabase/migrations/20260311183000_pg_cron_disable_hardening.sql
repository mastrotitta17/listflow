create or replace function public.disable_listflow_pg_cron_scheduler()
returns void
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  existing_job record;
  expected_command text := 'select public.listflow_pg_cron_dispatch();';
begin
  update private.listflow_scheduler_runtime_config
  set
    enabled = false,
    updated_at = timezone('utc', now())
  where id = 1;

  for existing_job in
    select jobid
    from cron.job
    where
      jobname = public.listflow_pg_cron_job_name()
      or btrim(coalesce(command, '')) = expected_command
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
    select jobid, jobname, schedule, command, active
    from cron.job
    where
      jobname = public.listflow_pg_cron_job_name()
      or btrim(coalesce(command, '')) = expected_command
    order by jobid asc
  loop
    if selected_job_id is null then
      if
        coalesce(existing_job.active, false) = true and
        coalesce(existing_job.schedule, '') = expected_schedule and
        btrim(coalesce(existing_job.command, '')) = expected_command and
        coalesce(existing_job.jobname, public.listflow_pg_cron_job_name()) = public.listflow_pg_cron_job_name()
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

create or replace function public.get_listflow_pg_cron_scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  cfg private.listflow_scheduler_runtime_config%rowtype;
  existing_job_id bigint;
  existing_job_active boolean;
  existing_job_schedule text;
  existing_job_command text;
  latest_run_status text;
  latest_run_details text;
  latest_run_started_at timestamptz;
  latest_run_ended_at timestamptz;
  expected_command text := 'select public.listflow_pg_cron_dispatch();';
begin
  select *
  into cfg
  from private.listflow_scheduler_runtime_config
  where id = 1;

  select jobid, active, schedule, command
  into existing_job_id, existing_job_active, existing_job_schedule, existing_job_command
  from cron.job
  where
    jobname = public.listflow_pg_cron_job_name()
    or btrim(coalesce(command, '')) = expected_command
  order by
    case when jobname = public.listflow_pg_cron_job_name() then 0 else 1 end asc,
    jobid asc
  limit 1;

  if existing_job_id is not null then
    select status, return_message, start_time, end_time
    into latest_run_status, latest_run_details, latest_run_started_at, latest_run_ended_at
    from cron.job_run_details
    where jobid = existing_job_id
    order by start_time desc
    limit 1;
  end if;

  return jsonb_build_object(
    'configured', cfg.id is not null,
    'enabled', coalesce(cfg.enabled, false),
    'schedulerBaseUrl', cfg.scheduler_base_url,
    'jobId', existing_job_id,
    'active', coalesce(existing_job_active, false),
    'schedule', existing_job_schedule,
    'command', existing_job_command,
    'lastRunStatus', latest_run_status,
    'lastRunDetails', latest_run_details,
    'lastRunStartedAt', latest_run_started_at,
    'lastRunEndedAt', latest_run_ended_at,
    'lastRequestId', cfg.last_request_id,
    'lastRequestQueuedAt', cfg.last_request_queued_at,
    'lastSyncedAt', cfg.last_synced_at
  );
end;
$$;
