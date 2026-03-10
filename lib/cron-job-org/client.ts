import { serverEnv } from "@/lib/env/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

const LISTFLOW_MASTER_SCHEDULER_TITLE = "Listflow Master Scheduler";
const POST_REQUEST_METHOD = 1;

export type SchedulerCronSyncResult =
  | {
      ok: true;
      status: "created" | "updated" | "deleted" | "noop";
      jobId?: number | null;
      message: string;
    }
  | {
      ok: false;
      status: "skipped" | "error";
      message: string;
      details?: string;
    };

export type DirectAutomationCronJob = {
  jobId: number;
  enabled: boolean;
  title: string;
  url: string;
  requestMethod: number;
  lastStatus: number | null;
  lastDuration: number | null;
  lastExecution: number | null;
  nextExecution: number | null;
  schedule: null;
  subscriptionId: string | null;
  storeId: string | null;
  webhookConfigId: string | null;
  plan: string | null;
};

export type CronJobOrgExecutionStatus = {
  state: "pending" | "success" | "failed";
  label: string;
  isSuccess: boolean;
};

type PgCronSchedulerState = {
  configured: boolean;
  enabled: boolean;
  schedulerBaseUrl: string | null;
  jobId: number | null;
  active: boolean;
  schedule: string | null;
  command: string | null;
  lastRunStatus: string | null;
  lastRunDetails: string | null;
  lastRunStartedAt: string | null;
  lastRunEndedAt: string | null;
  lastRequestId: number | null;
  lastRequestQueuedAt: string | null;
  lastSyncedAt: string | null;
};

const normalizeRpcPayload = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return {} as Record<string, unknown>;
};

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

const resolveSchedulerBaseUrl = () => {
  const raw = process.env.CRON_SCHEDULER_BASE_URL?.trim() || serverEnv.APP_URL?.trim();
  if (raw) {
    return stripTrailingSlashes(raw);
  }

  return stripTrailingSlashes(resolvePublicSiteUrl());
};

const mapLastRunStatusToExecutionCode = (status: string | null | undefined) => {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "succeeded" || normalized === "success") {
    return 1;
  }

  if (normalized === "failed") {
    return 2;
  }

  return 0;
};

const toUnixSeconds = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor(timestamp / 1000);
};

const parseSyncResult = (payload: unknown): SchedulerCronSyncResult => {
  const raw = normalizeRpcPayload(payload);
  const ok = raw.ok !== false;
  const statusValue = typeof raw.status === "string" ? raw.status : ok ? "updated" : "error";
  const message = typeof raw.message === "string" && raw.message.trim() ? raw.message : "Supabase pg_cron senkronu tamamlandı.";
  const jobId =
    typeof raw.jobId === "number"
      ? raw.jobId
      : typeof raw.jobId === "string" && raw.jobId.trim()
        ? Number(raw.jobId)
        : null;

  if (ok) {
    return {
      ok: true,
      status:
        statusValue === "created" || statusValue === "deleted" || statusValue === "noop" ? statusValue : "updated",
      jobId: Number.isFinite(jobId ?? NaN) ? jobId : null,
      message,
    };
  }

  return {
    ok: false,
    status: statusValue === "skipped" ? "skipped" : "error",
    message,
    details: typeof raw.details === "string" ? raw.details : undefined,
  };
};

const parseSchedulerState = (payload: unknown): PgCronSchedulerState => {
  const raw = normalizeRpcPayload(payload);
  const getNullableString = (key: string) => {
    const value = raw[key];
    return typeof value === "string" && value.trim() ? value : null;
  };
  const getNullableNumber = (key: string) => {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    configured: raw.configured === true,
    enabled: raw.enabled === true,
    schedulerBaseUrl: getNullableString("schedulerBaseUrl"),
    jobId: getNullableNumber("jobId"),
    active: raw.active === true,
    schedule: getNullableString("schedule"),
    command: getNullableString("command"),
    lastRunStatus: getNullableString("lastRunStatus"),
    lastRunDetails: getNullableString("lastRunDetails"),
    lastRunStartedAt: getNullableString("lastRunStartedAt"),
    lastRunEndedAt: getNullableString("lastRunEndedAt"),
    lastRequestId: getNullableNumber("lastRequestId"),
    lastRequestQueuedAt: getNullableString("lastRequestQueuedAt"),
    lastSyncedAt: getNullableString("lastSyncedAt"),
  };
};

const isMissingPgCronFunctionError = (error: { message?: string } | null | undefined) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("function") && message.includes("does not exist");
};

const isSchemaCacheFunctionMismatchError = (error: { message?: string } | null | undefined) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("could not find the function") && message.includes("schema cache");
};

const shouldFallbackToLegacyPgCronRpc = (error: { message?: string } | null | undefined) =>
  isMissingPgCronFunctionError(error) || isSchemaCacheFunctionMismatchError(error);

const callSyncPgCronSchedulerRpc = async (enabled: boolean) => {
  const schedulerBaseUrl = resolveSchedulerBaseUrl();
  const cronSecret = serverEnv.CRON_SECRET;

  const preferred = await supabaseAdmin.rpc("sync_listflow_pg_cron_scheduler", {
    p_scheduler_base_url: schedulerBaseUrl,
    p_cron_secret: cronSecret,
    p_enabled: enabled,
  });

  if (!preferred.error) {
    return preferred;
  }

  if (!shouldFallbackToLegacyPgCronRpc(preferred.error)) {
    return preferred;
  }

  const legacy = await supabaseAdmin.rpc("sync_listflow_pg_cron_scheduler", {
    p_cron_secret: cronSecret,
    p_enabled: enabled,
    p_scheduler_base_url: schedulerBaseUrl,
  });

  if (!legacy.error) {
    return legacy;
  }

  if (!shouldFallbackToLegacyPgCronRpc(legacy.error)) {
    return legacy;
  }

  return await supabaseAdmin.rpc("sync_listflow_pg_cron_scheduler_impl", {
    p_scheduler_base_url: schedulerBaseUrl,
    p_cron_secret: cronSecret,
    p_enabled: enabled,
  });
};

export const describeCronJobOrgExecutionStatus = (status: number | null | undefined): CronJobOrgExecutionStatus => {
  if (status === null || status === undefined || status === 0) {
    return {
      state: "pending",
      label: "Bekliyor",
      isSuccess: false,
    };
  }

  if (status === 1) {
    return {
      state: "success",
      label: "Başarılı",
      isSuccess: true,
    };
  }

  return {
    state: "failed",
    label: `Hata (${status})`,
    isSuccess: false,
  };
};

export const isDirectAutomationMode = () => false;

export const isPerStoreDirectCronEnabled = () => false;

export const loadSchedulerMasterState = async (): Promise<PgCronSchedulerState | null> => {
  const { data, error } = await supabaseAdmin.rpc("get_listflow_pg_cron_scheduler_status");
  if (error) {
    if (isMissingPgCronFunctionError(error)) {
      return null;
    }
    throw new Error(error.message || "Supabase pg_cron status yüklenemedi.");
  }

  return parseSchedulerState(data);
};

export const loadDirectAutomationCronJobs = async (_options?: { force?: boolean }): Promise<DirectAutomationCronJob[]> => {
  const schedulerState = await loadSchedulerMasterState();
  if (!schedulerState?.jobId) {
    return [];
  }

  return [
    {
      jobId: schedulerState.jobId,
      enabled: schedulerState.active,
      title: LISTFLOW_MASTER_SCHEDULER_TITLE,
      url: `${schedulerState.schedulerBaseUrl ?? resolveSchedulerBaseUrl()}/api/scheduler/tick`,
      requestMethod: POST_REQUEST_METHOD,
      lastStatus: mapLastRunStatusToExecutionCode(schedulerState.lastRunStatus),
      lastDuration: null,
      lastExecution: toUnixSeconds(schedulerState.lastRunStartedAt),
      nextExecution: null,
      schedule: null,
      subscriptionId: null,
      storeId: null,
      webhookConfigId: null,
      plan: null,
    },
  ];
};

export const findStrictDirectAutomationCronJob = async (
  _args?: unknown,
): Promise<DirectAutomationCronJob | null> => null;

export const ensureDirectAutomationCronJobForBinding = async (_args?: unknown): Promise<SchedulerCronSyncResult> =>
  syncSchedulerCronJobLifecycle();

export const ensureSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> =>
  syncSchedulerCronJobLifecycle();

export const deleteSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> => {
  const { data, error } = await callSyncPgCronSchedulerRpc(false);

  if (error) {
    return {
      ok: false,
      status: "error",
      message: "Supabase pg_cron scheduler devre dışı bırakılamadı.",
      details: error.message,
    };
  }

  return parseSyncResult(data);
};

export const syncSchedulerCronJobLifecycle = async (_options?: { force?: boolean }): Promise<SchedulerCronSyncResult> => {
  const { data, error } = await callSyncPgCronSchedulerRpc(true);

  if (error) {
    return {
      ok: false,
      status: "error",
      message: "Supabase pg_cron scheduler senkronu başarısız.",
      details: error.message,
    };
  }

  return parseSyncResult(data);
};
