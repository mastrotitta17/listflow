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
  existing_job record;
  latest_run record;
  expected_command text := 'select public.listflow_pg_cron_dispatch();';
begin
  select *
  into cfg
  from private.listflow_scheduler_runtime_config
  where id = 1;

  select jobid, jobname, active, schedule, command
  into existing_job
  from cron.job
  where
    jobname = public.listflow_pg_cron_job_name()
    or btrim(coalesce(command, '')) = expected_command
  order by
    case when jobname = public.listflow_pg_cron_job_name() then 0 else 1 end asc,
    jobid asc
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
