import { serverEnv } from "@/lib/env/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

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

type PgCronSchedulerState = {
  configured: boolean;
  enabled: boolean;
  schedulerBaseUrl: string | null;
  hasVercelBypassSecret: boolean;
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

const isLoopbackBaseUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  return /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?$/i.test(value.trim());
};

const isRemoteSupabaseProject = () => {
  return !isLoopbackBaseUrl(serverEnv.NEXT_PUBLIC_SUPABASE_URL);
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
    hasVercelBypassSecret: raw.hasVercelBypassSecret === true,
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

const syncPgCronVercelBypassSecret = async () => {
  return await supabaseAdmin.rpc("set_listflow_pg_cron_vercel_bypass_secret", {
    p_vercel_bypass_secret: serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET ?? null,
  });
};

const isMissingPgCronFunctionError = (error: { message?: string } | null | undefined) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("function") && message.includes("does not exist");
};

const isSchemaCacheFunctionMismatchError = (error: { message?: string } | null | undefined) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("could not find the function") && message.includes("schema cache");
};

const isFunctionOverloadAmbiguousError = (error: { message?: string } | null | undefined) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("is not unique") || message.includes("function") && message.includes("ambiguous");
};

const shouldFallbackToLegacyPgCronRpc = (error: { message?: string } | null | undefined) =>
  isMissingPgCronFunctionError(error) ||
  isSchemaCacheFunctionMismatchError(error) ||
  isFunctionOverloadAmbiguousError(error);

const callSyncPgCronSchedulerRpc = async (enabled: boolean) => {
  const schedulerBaseUrl = resolveSchedulerBaseUrl();
  const cronSecret = serverEnv.CRON_SECRET;

  if (enabled && isLoopbackBaseUrl(schedulerBaseUrl) && isRemoteSupabaseProject()) {
    return {
      data: {
        ok: false,
        status: "skipped",
        message:
          "pg_cron scheduler sync atlandı: CRON_SCHEDULER_BASE_URL loopback (localhost/127.0.0.1) ama Supabase remote projeye bağlı.",
      },
      error: null,
    };
  }

  const implPreferred = await supabaseAdmin.rpc("sync_listflow_pg_cron_scheduler_impl", {
    p_scheduler_base_url: schedulerBaseUrl,
    p_cron_secret: cronSecret,
    p_enabled: enabled,
  });

  if (!implPreferred.error) {
    return implPreferred;
  }

  if (!shouldFallbackToLegacyPgCronRpc(implPreferred.error)) {
    return implPreferred;
  }

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

  const bypassSync = await syncPgCronVercelBypassSecret();
  if (bypassSync.error && !isMissingPgCronFunctionError(bypassSync.error)) {
    return {
      ok: false,
      status: "error",
      message: "Supabase pg_cron Vercel bypass secret senkronu başarısız.",
      details: bypassSync.error.message,
    };
  }

  return parseSyncResult(data);
};
