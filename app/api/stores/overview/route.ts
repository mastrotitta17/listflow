import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env/server";
import {
  createScheduledSlotIdempotencyKey,
  extractScheduledSlotDueIso,
  getPlanWindowHours,
} from "@/lib/scheduler/idempotency";
import {
  isSubscriptionActive,
  summarizeStoreSubscriptions,
  type SettingsSubscriptionRow,
} from "@/lib/settings/subscriptions";
import { buildStoreAliasIndex } from "@/lib/subscriptions/store-resolution";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import {
  loadSchedulerMasterState,
  syncSchedulerCronJobLifecycle,
} from "@/lib/cron-job-org/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  category: string | null;
  store_currency?: "USD" | "TRY" | null;
  status: string | null;
  price_cents: number | null;
  active_webhook_config_id?: string | null;
  automation_updated_at?: string | null;
  created_at: string | null;
};

type StoreWebhookMappingSnapshot = {
  webhookConfigIds: string[];
  lastMappedAt: string | null;
};

type SubscriptionRow = SettingsSubscriptionRow;

type SchedulerJobRow = {
  id: string;
  subscription_id: string | null;
  store_id: string | null;
  idempotency_key: string | null;
  status: string | null;
  trigger_type: string | null;
  run_at: string | null;
  updated_at: string | null;
  retry_count: number | null;
  error_message: string | null;
  created_at: string | null;
};

type OrderCountRow = {
  id: string;
  store_id?: string | null;
  payment_status?: string | null;
  category_name?: string | null;
};

type OrderBackfillSummary = {
  scanned: number;
  updated: number;
  unresolved: number;
};

type CronLifecycleSnapshot = {
  lastCronSyncAt: string | null;
  lastCronSyncStatus: "success" | "skipped" | "error" | null;
  lastCronSyncMessage: string | null;
};

type DirectCronHealth = {
  directCronPresent: boolean;
  directCronJobId: number | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isRecoverableColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const chunkArray = <T>(items: T[], size: number) => {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const normalizeCategoryKey = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizeStoreCurrency = (value: string | null | undefined): "USD" | "TRY" | null => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "TRY" || normalized === "TL" || normalized === "₺" || normalized === "TURKISH_LIRA") {
    return "TRY";
  }

  if (normalized === "USD" || normalized === "$") {
    return "USD";
  }

  return null;
};

const parseScheduledStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("scheduled:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 5 ? parts[2] : null;
  }

  return null;
};

const parseManualStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("manual_switch:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 4 ? parts[1] : null;
  }

  return null;
};

const parseActivationStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("activation:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 4 ? parts[2] : null;
  }

  return null;
};

const resolveStoreIdForJob = (job: SchedulerJobRow) => {
  return (
    job.store_id ??
    parseScheduledStoreIdFromKey(job.idempotency_key) ??
    parseManualStoreIdFromKey(job.idempotency_key) ??
    parseActivationStoreIdFromKey(job.idempotency_key)
  );
};

const isScheduledJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "scheduled") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("scheduled:");
};

const isManualSwitchJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "manual_switch") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("manual_switch:");
};

const isActivationJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "activation") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("activation:");
};

const getMostRecentIso = (rows: Array<{ run_at: string | null; created_at: string | null }>) => {
  let best: string | null = null;

  for (const row of rows) {
    const candidate = row.run_at ?? row.created_at;
    if (!candidate) {
      continue;
    }

    if (!best || new Date(candidate).getTime() > new Date(best).getTime()) {
      best = candidate;
    }
  }

  return best;
};

const getJobTimestamp = (job: Pick<SchedulerJobRow, "run_at" | "updated_at" | "created_at">) => {
  const candidates = [job.run_at, job.updated_at, job.created_at];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const getLatestScheduledSlotDueMs = (jobs: SchedulerJobRow[]) => {
  let best = -1;

  for (const job of jobs) {
    if (!isScheduledJob(job)) {
      continue;
    }

    const slotDueIso = extractScheduledSlotDueIso(job.idempotency_key);
    if (!slotDueIso) {
      continue;
    }

    const slotDueMs = new Date(slotDueIso).getTime();
    if (Number.isNaN(slotDueMs)) {
      continue;
    }

    if (slotDueMs > best) {
      best = slotDueMs;
    }
  }

  return best >= 0 ? best : null;
};

const findScheduledSlotJob = (jobs: SchedulerJobRow[], storeId: string, slotKey: string) => {
  for (const job of jobs) {
    if (!isScheduledJob(job)) {
      continue;
    }

    if ((resolveStoreIdForJob(job) ?? storeId) !== storeId) {
      continue;
    }

    if (job.idempotency_key === slotKey) {
      return job;
    }
  }

  return null;
};

const getRetryDelayMinutes = (retryCount: number) => {
  if (retryCount <= 0) {
    return 1;
  }

  const retrySchedule = [1, 2, 4, 8, 16] as const;
  return retrySchedule[Math.min(retryCount - 1, retrySchedule.length - 1)];
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const loadSubscriptions = async (userId: string) => {
  const stripeMode = serverEnv.STRIPE_MODE;
  const candidates = [
    {
      select: "id, user_id, store_id, shop_id, plan, status, current_period_end, updated_at, created_at, stripe_mode",
      hasStoreId: true,
      hasStripeMode: true,
    },
    {
      select: "id, user_id, shop_id, plan, status, current_period_end, updated_at, created_at, stripe_mode",
      hasStoreId: false,
      hasStripeMode: true,
    },
    {
      select: "id, user_id, store_id, shop_id, plan, status, current_period_end, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: false,
    },
    {
      select: "id, user_id, shop_id, plan, status, current_period_end, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("subscriptions")
      .select(candidate.select)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (candidate.hasStripeMode) {
      query = query.or(`stripe_mode.eq.${stripeMode},stripe_mode.is.null`);
    }

    const attempt = await query;
    if (!attempt.error) {
      return (((attempt.data ?? []) as unknown) as SubscriptionRow[]).map((row) => ({
        ...row,
        store_id: candidate.hasStoreId
          ? row.store_id ?? null
          : row.shop_id && isUuid(row.shop_id)
            ? row.shop_id
            : null,
      }));
    }

    lastError = attempt.error.message;
    if (!isRecoverableColumnError(attempt.error, ["store_id", "stripe_mode"])) {
      throw new Error(attempt.error.message);
    }
  }

  throw new Error(lastError ?? "subscriptions could not be loaded");
};

const loadSchedulerJobs = async (subscriptionIds: string[]) => {
  if (!subscriptionIds.length) {
    return [] as SchedulerJobRow[];
  }

  const selectCandidates = [
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, updated_at, retry_count, error_message, created_at",
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, trigger_type, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, run_at, created_at",
  ] as const;

  let lastErrorMessage = "scheduler jobs could not be loaded";

  for (const select of selectCandidates) {
    const { data, error } = await supabaseAdmin
      .from("scheduler_jobs")
      .select(select)
      .in("subscription_id", subscriptionIds)
      .order("run_at", { ascending: false })
      .limit(1500);

    if (!error) {
      const rawRows = (data ?? []) as unknown as Array<{
        id: string;
        subscription_id?: string | null;
        store_id?: string | null;
        idempotency_key?: string | null;
        status?: string | null;
        trigger_type?: string | null;
        run_at?: string | null;
        updated_at?: string | null;
        retry_count?: number | null;
        error_message?: string | null;
        created_at?: string | null;
      }>;

      const rows = rawRows.map((row) => ({
        id: row.id,
        subscription_id: row.subscription_id ?? null,
        store_id: row.store_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        status: row.status ?? null,
        trigger_type: row.trigger_type ?? null,
        run_at: row.run_at ?? null,
        updated_at: row.updated_at ?? null,
        retry_count: row.retry_count ?? null,
        error_message: row.error_message ?? null,
        created_at: row.created_at ?? null,
      }));

      return rows as SchedulerJobRow[];
    }

    lastErrorMessage = error.message;

    if (!isRecoverableColumnError(error, ["store_id", "trigger_type", "updated_at", "retry_count", "error_message"])) {
      throw new Error(error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadStores = async (userId: string) => {
  const candidates = [
    {
      select:
        "id, user_id, store_name, category, status, price_cents, store_currency, currency, active_webhook_config_id, automation_updated_at, created_at",
      hasStoreCurrencyColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, store_currency, currency, active_webhook_config_id, created_at",
      hasStoreCurrencyColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, store_currency, currency, automation_updated_at, created_at",
      hasStoreCurrencyColumn: true,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, store_currency, currency, created_at",
      hasStoreCurrencyColumn: true,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, active_webhook_config_id, automation_updated_at, created_at",
      hasStoreCurrencyColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, active_webhook_config_id, created_at",
      hasStoreCurrencyColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, automation_updated_at, created_at",
      hasStoreCurrencyColumn: false,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, created_at",
      hasStoreCurrencyColumn: false,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
  ] as const;

  let lastErrorMessage = "stores could not be loaded";

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!query.error) {
      const rows = ((query.data ?? []) as unknown as Array<{
        id: string;
        user_id: string;
        store_name: string;
        category: string | null;
        store_currency?: string | null;
        currency?: string | null;
        status: string | null;
        price_cents: number | null;
        active_webhook_config_id?: string | null;
        automation_updated_at?: string | null;
        created_at: string | null;
      }>).map((row) => ({
        ...row,
        store_currency: candidate.hasStoreCurrencyColumn
          ? normalizeStoreCurrency(row.store_currency ?? row.currency ?? null)
          : null,
        active_webhook_config_id: candidate.hasActiveWebhookColumn ? row.active_webhook_config_id ?? null : null,
        automation_updated_at: candidate.hasAutomationUpdatedAtColumn ? row.automation_updated_at ?? null : null,
      }));

      return {
        rows: rows as StoreRow[],
        hasActiveWebhookColumn: candidate.hasActiveWebhookColumn,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isRecoverableColumnError(query.error, ["store_currency", "currency", "active_webhook_config_id", "automation_updated_at"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadPaidOrderCounts = async (args: { userId: string; storeIds: string[] }) => {
  const countsByStoreId = new Map<string, number>();
  for (const storeId of args.storeIds) {
    countsByStoreId.set(storeId, 0);
  }

  if (!args.storeIds.length) {
    return {
      countsByStoreId,
      orphanPaidCount: 0,
    };
  }

  const candidates = [
    { select: "id, store_id, payment_status", hasStoreId: true, hasPaymentStatus: true },
    { select: "id, payment_status", hasStoreId: false, hasPaymentStatus: true },
    { select: "id, store_id", hasStoreId: true, hasPaymentStatus: false },
    { select: "id", hasStoreId: false, hasPaymentStatus: false },
  ] as const;

  let lastErrorMessage = "orders could not be loaded";
  const allowedStoreIds = new Set(args.storeIds);

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("orders")
      .select(candidate.select)
      .eq("user_id", args.userId)
      .limit(5000);

    if (!query.error) {
      const rows = (query.data ?? []) as unknown as OrderCountRow[];
      let orphanPaidCount = 0;

      for (const row of rows) {
        if (candidate.hasPaymentStatus) {
          const paymentStatus = (row.payment_status ?? "").toLowerCase();
          if (paymentStatus !== "paid") {
            continue;
          }
        } else {
          continue;
        }

        const storeId = candidate.hasStoreId ? row.store_id ?? null : null;

        if (storeId && allowedStoreIds.has(storeId)) {
          countsByStoreId.set(storeId, (countsByStoreId.get(storeId) ?? 0) + 1);
          continue;
        }

        orphanPaidCount += 1;
      }

      return {
        countsByStoreId,
        orphanPaidCount,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isRecoverableColumnError(query.error, ["store_id", "payment_status"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const resolveSafeBackfillStoreId = (args: {
  stores: StoreRow[];
  orderCategoryName: string | null | undefined;
  activeSubscriptionStoreIds: Set<string>;
}) => {
  if (args.stores.length === 1) {
    return args.stores[0]?.id ?? null;
  }

  const normalizedOrderCategory = normalizeCategoryKey(args.orderCategoryName);
  if (normalizedOrderCategory) {
    const categoryMatches = args.stores.filter((store) => normalizeCategoryKey(store.category) === normalizedOrderCategory);
    if (categoryMatches.length === 1) {
      return categoryMatches[0]?.id ?? null;
    }
  }

  if (args.activeSubscriptionStoreIds.size === 1) {
    return Array.from(args.activeSubscriptionStoreIds)[0] ?? null;
  }

  return null;
};

const backfillLegacyPaidOrdersWithoutStoreId = async (args: {
  userId: string;
  stores: StoreRow[];
  activeSubscriptionStoreIds: Set<string>;
}): Promise<OrderBackfillSummary> => {
  const summary: OrderBackfillSummary = {
    scanned: 0,
    updated: 0,
    unresolved: 0,
  };

  if (!args.stores.length) {
    return summary;
  }

  const candidates = [
    { select: "id, store_id, payment_status, category_name", hasStoreId: true, hasPaymentStatus: true, hasCategoryName: true },
    { select: "id, store_id, payment_status", hasStoreId: true, hasPaymentStatus: true, hasCategoryName: false },
    { select: "id, payment_status, category_name", hasStoreId: false, hasPaymentStatus: true, hasCategoryName: true },
    { select: "id, payment_status", hasStoreId: false, hasPaymentStatus: true, hasCategoryName: false },
  ] as const;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("orders")
      .select(candidate.select)
      .eq("user_id", args.userId)
      .limit(5000);

    if (query.error) {
      if (!isRecoverableColumnError(query.error, ["store_id", "payment_status", "category_name"])) {
        throw new Error(query.error.message);
      }
      continue;
    }

    if (!candidate.hasStoreId || !candidate.hasPaymentStatus) {
      return summary;
    }

    const rows = (query.data ?? []) as unknown as OrderCountRow[];

    for (const row of rows) {
      const paymentStatus = (row.payment_status ?? "").toLowerCase();
      if (paymentStatus !== "paid") {
        continue;
      }

      if (row.store_id) {
        continue;
      }

      summary.scanned += 1;

      const targetStoreId = resolveSafeBackfillStoreId({
        stores: args.stores,
        orderCategoryName: candidate.hasCategoryName ? row.category_name ?? null : null,
        activeSubscriptionStoreIds: args.activeSubscriptionStoreIds,
      });

      if (!targetStoreId) {
        summary.unresolved += 1;
        continue;
      }

      const withUpdatedAt = await supabaseAdmin
        .from("orders")
        .update({
          store_id: targetStoreId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", args.userId);

      if (!withUpdatedAt.error) {
        summary.updated += 1;
        continue;
      }

      if (!isMissingColumnError(withUpdatedAt.error, "updated_at")) {
        if (!isRecoverableColumnError(withUpdatedAt.error, ["store_id", "updated_at"])) {
          throw new Error(withUpdatedAt.error.message);
        }
      }

      const fallback = await supabaseAdmin
        .from("orders")
        .update({
          store_id: targetStoreId,
        })
        .eq("id", row.id)
        .eq("user_id", args.userId);

      if (fallback.error) {
        if (!isRecoverableColumnError(fallback.error, ["store_id"])) {
          throw new Error(fallback.error.message);
        }

        summary.unresolved += 1;
        continue;
      }

      summary.updated += 1;
    }

    return summary;
  }

  return summary;
};

const loadStoreWebhookMappingsFromLogs = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, StoreWebhookMappingSnapshot>();
  }

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return new Map<string, StoreWebhookMappingSnapshot>();
  }

  const allowedStoreIds = new Set(storeIds);
  const mapping = new Map<string, StoreWebhookMappingSnapshot>();

  for (const row of (data ?? []) as Array<{ request_body: unknown; request_url?: string | null; created_at: string | null }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;

    const sourceUrl = typeof row.request_url === "string" ? row.request_url : null;
    const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : null;
    const isManualBinding = sourceUrl === "store-webhook-mapping" || (idempotencyKey?.startsWith("manual_switch:") ?? false);
    const isActivationBinding =
      sourceUrl === "store-webhook-mapping-activation" || (idempotencyKey?.startsWith("activation:") ?? false);
    const isAutoBindMapping =
      sourceUrl === "store-webhook-mapping-auto-bind" || (idempotencyKey?.startsWith("auto_bind:") ?? false);
    if (!isManualBinding && !isActivationBinding && !isAutoBindMapping) {
      continue;
    }

    const storeId = typeof body?.store_id === "string" ? body.store_id : null;
    const webhookConfigId = typeof body?.webhook_config_id === "string" ? body.webhook_config_id : null;

    if (!storeId || !webhookConfigId || !allowedStoreIds.has(storeId)) {
      continue;
    }

    const current = mapping.get(storeId) ?? {
      webhookConfigIds: [],
      lastMappedAt: row.created_at ?? null,
    };

    if (!current.webhookConfigIds.includes(webhookConfigId)) {
      current.webhookConfigIds.push(webhookConfigId);
    }

    if (!current.lastMappedAt) {
      current.lastMappedAt = row.created_at ?? null;
    }

    mapping.set(storeId, current);
  }

  return mapping;
};

const loadActiveAutomationWebhookIdsByIds = async (webhookConfigIds: string[]) => {
  const uniqueIds = Array.from(new Set(webhookConfigIds.filter((value): value is string => Boolean(value))));
  if (!uniqueIds.length) {
    return new Set<string>();
  }

  const candidates = [
    "id, enabled, scope",
    "id, enabled",
    "id, scope",
    "id",
  ] as const;

  const activeIds = new Set<string>();
  const idChunks = chunkArray(uniqueIds, 200);

  for (const idChunk of idChunks) {
    let resolvedChunk = false;

    for (const select of candidates) {
      const { data, error } = await supabaseAdmin
        .from("webhook_configs")
        .select(select)
        .in("id", idChunk);

      if (error) {
        if (!isRecoverableColumnError(error, ["enabled", "scope"])) {
          throw new Error(error.message);
        }
        continue;
      }

      const rows = (data ?? []) as unknown as Array<{ id: string; enabled?: boolean | null; scope?: string | null }>;
      for (const row of rows) {
        if (row.enabled === false) {
          continue;
        }

        if (row.scope && row.scope === "generic") {
          continue;
        }

        activeIds.add(row.id);
      }

      resolvedChunk = true;
      break;
    }

    if (!resolvedChunk) {
      for (const fallbackId of idChunk) {
        activeIds.add(fallbackId);
      }
    }
  }

  return activeIds;
};

const loadLatestCronTickMs = async () => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("created_at")
    .eq("request_method", "CRON_TICK")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null }>();

  if (error || !data?.created_at) {
    return null;
  }

  const parsed = new Date(data.created_at).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const parseCronLifecycleResponse = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      ok?: boolean;
      status?: string | null;
      message?: string | null;
    };
    return {
      status: typeof parsed.status === "string" ? parsed.status : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
      ok: parsed.ok === true,
    };
  } catch {
    return {
      status: null,
      message: value,
      ok: false,
    };
  }
};

const loadLatestCronLifecycleSnapshot = async (): Promise<CronLifecycleSnapshot> => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("created_at,response_body")
    .eq("request_method", "CRON_LIFECYCLE_SYNC")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null; response_body?: string | null }>();

  if (error || !data) {
    return {
      lastCronSyncAt: null,
      lastCronSyncStatus: null,
      lastCronSyncMessage: null,
    };
  }

  const parsed = parseCronLifecycleResponse(data.response_body ?? null);
  const status = parsed?.status;

  return {
    lastCronSyncAt: data.created_at ?? null,
    lastCronSyncStatus:
      status === "error" ? "error" : status === "skipped" ? "skipped" : parsed?.ok ? "success" : "success",
    lastCronSyncMessage: parsed?.message ?? null,
  };
};

const loadSchedulerHealthByStoreId = async (storeIds: string[]) => {
  const map = new Map<string, DirectCronHealth>();
  if (!storeIds.length) {
    return map;
  }

  try {
    const schedulerState = await loadSchedulerMasterState();
    const masterSchedulerPresent = Boolean(
      schedulerState?.enabled && schedulerState.active && schedulerState.jobId
    );

    if (!masterSchedulerPresent) {
      return map;
    }

    for (const storeId of storeIds) {
      map.set(storeId, {
        directCronPresent: true,
        directCronJobId: schedulerState?.jobId ?? null,
      });
    }
  } catch {
    return map;
  }

  return map;
};

const triggerTickWithCronSecret = async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return false;
  }

  try {
    const response = await fetch(`${request.nextUrl.origin}/api/scheduler/tick`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "x-listflow-tick-source": "stores-overview-fallback",
      },
    });

    return response.ok;
  } catch {
    return false;
  }
};

export async function GET(request: NextRequest) {
  try {
    const token = getAccessToken(request);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows: stores } = await loadStores(user.id);
    const subscriptions = await loadSubscriptions(user.id);
    const subscriptionIds = subscriptions.map((row) => row.id);
    const storeIds = stores.map((store) => store.id);
    const storeAliasIndex = buildStoreAliasIndex(
      stores.map((store) => ({
        id: store.id,
        user_id: store.user_id,
        store_name: store.store_name,
      }))
    );
    const cronLifecycleSnapshotPromise = loadLatestCronLifecycleSnapshot();
    const activeSubscriptionStoreIds = new Set(
      subscriptions
        .filter((row) => isSubscriptionActive(row))
        .map((row) =>
          storeAliasIndex.resolve({
            user_id: row.user_id,
            store_id: row.store_id ?? null,
            shop_id: row.shop_id ?? null,
          })
        )
        .filter((value): value is string => Boolean(value))
    );

    let schedulerJobs: SchedulerJobRow[] = [];

    try {
      schedulerJobs = await loadSchedulerJobs(subscriptionIds);
    } catch {
      schedulerJobs = [];
    }

    const orderBackfill = await backfillLegacyPaidOrdersWithoutStoreId({
      userId: user.id,
      stores,
      activeSubscriptionStoreIds,
    });

    const { countsByStoreId, orphanPaidCount } = await loadPaidOrderCounts({
      userId: user.id,
      storeIds,
    });

    // Legacy orders created without store_id are assignable only when user has one store.
    if (orphanPaidCount > 0 && storeIds.length === 1) {
      const singleStoreId = storeIds[0];
      countsByStoreId.set(singleStoreId, (countsByStoreId.get(singleStoreId) ?? 0) + orphanPaidCount);
    }

    const fallbackStoreWebhookMap = await loadStoreWebhookMappingsFromLogs(storeIds);
    const directCronHealthByStoreId = await loadSchedulerHealthByStoreId(storeIds);
    const cronLifecycleSnapshot = await cronLifecycleSnapshotPromise;
    const schedulerMasterState = await loadSchedulerMasterState().catch(() => null);
    const schedulerManuallyDisabled = schedulerMasterState?.enabled === false;
    const candidateWebhookIds = new Set<string>();
    for (const store of stores) {
      if (store.active_webhook_config_id) {
        candidateWebhookIds.add(store.active_webhook_config_id);
      }

      const fallbackIds = fallbackStoreWebhookMap.get(store.id)?.webhookConfigIds ?? [];
      for (const fallbackId of fallbackIds) {
        candidateWebhookIds.add(fallbackId);
      }
    }

    const activeAutomationWebhookIds = await loadActiveAutomationWebhookIdsByIds(Array.from(candidateWebhookIds));
    const resolveStoreWebhookId = (store: StoreRow) => {
      const explicitId = store.active_webhook_config_id;

      if (explicitId && activeAutomationWebhookIds.has(explicitId)) {
        return explicitId;
      }

      const fallbackCandidates = fallbackStoreWebhookMap.get(store.id)?.webhookConfigIds ?? [];
      for (const candidateId of fallbackCandidates) {
        if (activeAutomationWebhookIds.has(candidateId)) {
          return candidateId;
        }
      }

      return null;
    };

    const rows = stores.map((store) => {
      const matchedSubscriptions = subscriptions
        .filter((row) => {
          const storeId = storeAliasIndex.resolve({
            user_id: row.user_id,
            store_id: row.store_id ?? null,
            shop_id: row.shop_id ?? null,
          });
          return storeId === store.id;
        })
        .sort((a, b) => {
          const aTs = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
          const bTs = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
          return bTs - aTs;
        });

      const renewalSnapshot = summarizeStoreSubscriptions(matchedSubscriptions);
      const activeSubscription = renewalSnapshot.activeSubscription;
      const primarySubscription = renewalSnapshot.latestSubscription;

      const plan = (renewalSnapshot.lastSubscriptionPlan ?? null)?.toLowerCase() || null;
      const intervalHours = plan ? getPlanWindowHours(plan) : null;
      const intervalMs = intervalHours ? intervalHours * 60 * 60 * 1000 : null;
      const nowMs = Date.now();
      const configuredWebhookId = resolveStoreWebhookId(store);
      const hasActiveAutomationWebhook = Boolean(configuredWebhookId);
      const directCronHealth = directCronHealthByStoreId.get(store.id) ?? {
        directCronPresent: false,
        directCronJobId: null,
      };

      const subscriptionJobs = primarySubscription
        ? schedulerJobs.filter((job) => job.subscription_id === primarySubscription.id)
        : [];

      const storeScopedJobs = subscriptionJobs.filter((job) => {
        const resolvedStoreId = resolveStoreIdForJob(job);
        return resolvedStoreId ? resolvedStoreId === store.id : true;
      });

      const cadenceAnchorJobs = storeScopedJobs.filter((job) => {
        const status = (job.status ?? "").toLowerCase();

        if (status !== "success") {
          return false;
        }

        return isScheduledJob(job) || isManualSwitchJob(job) || isActivationJob(job);
      });

      const lastSuccessfulAutomationAt = getMostRecentIso(cadenceAnchorJobs);
      const latestScheduledSlotDueMs = getLatestScheduledSlotDueMs(storeScopedJobs);
      const mappingSnapshot = fallbackStoreWebhookMap.get(store.id);

      let nextAutomationAtMs: number | null = null;
      let slotJobForState: SchedulerJobRow | null = null;
      let slotRetryCount = 0;

      if (intervalMs !== null && hasActiveAutomationWebhook) {
        let slotDueMs = (() => {
          if (lastSuccessfulAutomationAt) {
            return new Date(lastSuccessfulAutomationAt).getTime() + intervalMs;
          }

          if (latestScheduledSlotDueMs !== null) {
            return latestScheduledSlotDueMs;
          }

          return nowMs;
        })();

        if (primarySubscription?.id && plan) {
          let slotDueIso = new Date(slotDueMs).toISOString();
          let slotKey = createScheduledSlotIdempotencyKey({
            subscriptionId: primarySubscription.id,
            storeId: store.id,
            plan,
            slotDueAtIso: slotDueIso,
          });
          let slotJob = findScheduledSlotJob(storeScopedJobs, store.id, slotKey);

          while (
            slotJob &&
            (slotJob.status ?? "").toLowerCase() === "failed" &&
            (slotJob.retry_count ?? 0) >= 5
          ) {
            slotDueMs += intervalMs;
            slotDueIso = new Date(slotDueMs).toISOString();
            slotKey = createScheduledSlotIdempotencyKey({
              subscriptionId: primarySubscription.id,
              storeId: store.id,
              plan,
              slotDueAtIso: slotDueIso,
            });
            slotJob = findScheduledSlotJob(storeScopedJobs, store.id, slotKey);
          }

          slotJobForState = slotJob;
          slotRetryCount = slotJob?.retry_count ?? 0;

          if (slotJob && (slotJob.status ?? "").toLowerCase() === "failed") {
            if (slotRetryCount < 5) {
              const retryAtMs = getJobTimestamp(slotJob) + getRetryDelayMinutes(slotRetryCount) * 60 * 1000;
              nextAutomationAtMs = retryAtMs;
            } else {
              nextAutomationAtMs = slotDueMs + intervalMs;
            }
          } else {
            nextAutomationAtMs = slotDueMs;
          }
        } else {
          nextAutomationAtMs = slotDueMs;
        }
      }

      const nextAutomationAt = nextAutomationAtMs !== null ? new Date(nextAutomationAtMs).toISOString() : null;
      const hasRetryWindow =
        Boolean(slotJobForState) &&
        (slotJobForState?.status ?? "").toLowerCase() === "failed" &&
        slotRetryCount < 5;
      const hasTerminalFailure =
        Boolean(slotJobForState) &&
        (slotJobForState?.status ?? "").toLowerCase() === "failed" &&
        slotRetryCount >= 5;

      const hasProcessingAutomation = subscriptionJobs.some((job) => {
        const status = (job.status ?? "").toLowerCase();
        if (status !== "processing") {
          return false;
        }

        const resolvedStoreId = resolveStoreIdForJob(job);
        return resolvedStoreId ? resolvedStoreId === store.id : true;
      });

      const hasActiveSubscription = renewalSnapshot.renewalState === "active";
      const canDelete = !hasActiveSubscription && !hasProcessingAutomation;
      const deleteBlockedReason = hasActiveSubscription
        ? "active_subscription"
        : hasProcessingAutomation
          ? "automation_running"
          : null;

      const automationState: "waiting" | "due" | "processing" | "retrying" | "error" = (() => {
        if (!hasActiveSubscription || !intervalMs || !hasActiveAutomationWebhook) {
          return "waiting";
        }

        if (hasProcessingAutomation) {
          return "processing";
        }

        if (hasRetryWindow) {
          return "retrying";
        }

        if (nextAutomationAtMs !== null && nextAutomationAtMs <= nowMs) {
          return "due";
        }

        if (hasTerminalFailure) {
          return "error";
        }

        return "waiting";
      })();

      return {
        id: store.id,
        storeName: store.store_name,
        category: store.category,
        storeCurrency: store.store_currency ?? null,
        status: store.status,
        priceCents: store.price_cents ?? 0,
        orderCount: countsByStoreId.get(store.id) ?? 0,
        hasActiveSubscription,
        renewalRequired: renewalSnapshot.renewalRequired,
        renewalState: renewalSnapshot.renewalState,
        hasActiveAutomationWebhook,
        plan,
        subscriptionStatus: activeSubscription?.status ?? primarySubscription?.status ?? null,
        currentPeriodEnd: renewalSnapshot.currentPeriodEnd,
        lastSubscriptionPlan: renewalSnapshot.lastSubscriptionPlan,
        lastSubscriptionInterval: renewalSnapshot.lastSubscriptionInterval,
        automationIntervalHours: intervalHours,
        automationLastRunAt: lastSuccessfulAutomationAt,
        lastSuccessfulAutomationAt,
        nextAutomationAt,
        automationState,
        directCronPresent: directCronHealth.directCronPresent,
        directCronJobId: directCronHealth.directCronJobId,
        lastCronSyncAt: cronLifecycleSnapshot.lastCronSyncAt,
        lastCronSyncStatus: cronLifecycleSnapshot.lastCronSyncStatus,
        lastCronSyncMessage: cronLifecycleSnapshot.lastCronSyncMessage,
        canDelete,
        deleteBlockedReason,
      };
    });

    const missingDirectCronForEligibleStore = rows.some((row) => {
      if (!row.hasActiveSubscription || row.renewalState !== "active") {
        return false;
      }

      if (!row.hasActiveAutomationWebhook) {
        return false;
      }

      return row.directCronPresent !== true;
    });

    if (missingDirectCronForEligibleStore && !schedulerManuallyDisabled) {
      await syncSchedulerCronJobLifecycle().catch(() => null);
    }

    const nowMs = Date.now();
    const hasDueAutomation = rows.some((row) => {
      if (!row.hasActiveSubscription || !row.hasActiveAutomationWebhook || row.automationState === "processing") {
        return false;
      }

      if (!row.nextAutomationAt) {
        return false;
      }

      const nextAutomationAtMs = new Date(row.nextAutomationAt).getTime();
      if (Number.isNaN(nextAutomationAtMs)) {
        return false;
      }

      return nextAutomationAtMs <= nowMs;
    });

    if (hasDueAutomation && !schedulerManuallyDisabled) {
      const latestCronTickMs = await loadLatestCronTickMs();
      const isCronStale = latestCronTickMs === null || nowMs - latestCronTickMs > 3 * 60 * 1000;

      if (isCronStale) {
        await triggerTickWithCronSecret(request);
      }
    }

    return NextResponse.json({
      rows,
      meta: {
        orderBackfill,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load stores overview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
