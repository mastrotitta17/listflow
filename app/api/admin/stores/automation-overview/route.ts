import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getSubscriptionMonthIndex } from "@/lib/admin/automation";
import {
  createScheduledSlotIdempotencyKey,
  extractScheduledSlotDueIso,
  getPlanWindowHours,
} from "@/lib/scheduler/idempotency";
import {
  describeCronJobOrgExecutionStatus,
  isDirectAutomationMode,
  isPerStoreDirectCronEnabled,
  loadDirectAutomationCronJobs,
  syncSchedulerCronJobLifecycle,
} from "@/lib/cron-job-org/client";
import {
  isWebhookCompatibleWithStore,
  resolveProductCandidateForCategory,
  type ProductMatchCandidate,
} from "@/lib/stores/product-resolution";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  status: string | null;
  category: string | null;
  product_id: string | null;
  active_webhook_config_id: string | null;
  automation_updated_at: string | null;
};

type StoreCurrency = "USD" | "TRY";

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan: string | null;
  status: string | null;
  created_at: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

type SchedulerJobRow = {
  id: string;
  store_id: string | null;
  subscription_id: string | null;
  webhook_config_id: string | null;
  idempotency_key: string | null;
  status: string | null;
  trigger_type: string | null;
  response_status: number | null;
  error_message: string | null;
  run_at: string | null;
  updated_at: string | null;
  retry_count: number | null;
  created_at: string | null;
};

type WebhookConfigRow = {
  id: string;
  name: string;
  description: string | null;
  target_url: string;
  method: string | null;
  enabled: boolean | null;
  product_id: string | null;
  currency: StoreCurrency | null;
  scope?: string | null;
};

type ProductRow = {
  id: string;
  category_id: string | null;
  title_tr: string | null;
  title_en: string | null;
};

type CategoryRow = {
  id: string;
  title_tr: string | null;
  title_en: string | null;
  slug: string | null;
};

type MappingTriggerType = "manual_switch" | "activation" | "auto_switch";

type StoreWebhookMappingTrigger = {
  status: "success";
  triggerType: MappingTriggerType;
  responseStatus: 200;
  responseStatusLabel: "HTTP 200";
  responseStatusSource: "http";
  errorMessage: null;
  createdAt: string | null;
  webhookConfigId: string | null;
};

type StoreWebhookMappingSnapshot = {
  webhookConfigIds: string[];
  lastMappedAt: string | null;
  lastTrigger: StoreWebhookMappingTrigger | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingAnyColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const normalizeCurrency = (value: string | null | undefined): StoreCurrency => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (
    normalized === "TRY" ||
    normalized === "TL" ||
    normalized === "₺" ||
    normalized === "TURKISHLIRA" ||
    normalized === "TURKISH_LIRA"
  ) {
    return "TRY";
  }
  return "USD";
};

const pickNonEmptyCurrency = (primary: string | null | undefined, fallback: string | null | undefined) => {
  const first = (primary ?? "").trim();
  if (first) {
    return first;
  }

  const second = (fallback ?? "").trim();
  return second || null;
};

const normalizeWebhookCurrency = (value: string | null | undefined): StoreCurrency | null => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized === "TRY" ||
    normalized === "TL" ||
    normalized === "₺" ||
    normalized === "TURKISHLIRA" ||
    normalized === "TURKISH_LIRA"
  ) {
    return "TRY";
  }

  if (normalized === "USD") {
    return normalized;
  }

  return null;
};

const loadStores = async () => {
  const candidates = [
    {
      select: "id, user_id, store_name, status, category, product_id, active_webhook_config_id, automation_updated_at",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, status, category, product_id, active_webhook_config_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category, active_webhook_config_id, automation_updated_at",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, status, category, active_webhook_config_id",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category, product_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category",
      hasProductColumn: false,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
  ] as const;

  let lastErrorMessage = "stores could not be loaded";

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .order("created_at", { ascending: true });

    if (!query.error) {
      const rows = ((query.data ?? []) as unknown as Array<{
        id: string;
        user_id: string;
        store_name: string;
        status?: string | null;
        category?: string | null;
        product_id?: string | null;
        active_webhook_config_id?: string | null;
        automation_updated_at?: string | null;
      }>).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        store_name: row.store_name,
        status: row.status ?? null,
        category: row.category ?? null,
        product_id: candidate.hasProductColumn ? row.product_id ?? null : null,
        active_webhook_config_id: candidate.hasActiveWebhookColumn ? row.active_webhook_config_id ?? null : null,
        automation_updated_at: candidate.hasAutomationUpdatedAtColumn ? row.automation_updated_at ?? null : null,
      })) as StoreRow[];

      return {
        rows,
        hasActiveWebhookColumn: candidate.hasActiveWebhookColumn,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isMissingAnyColumnError(query.error, ["product_id", "active_webhook_config_id", "automation_updated_at"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadProfiles = async (userIds: string[]) => {
  if (!userIds.length) {
    return [] as ProfileRow[];
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProfileRow[];
};

const loadStoreCurrencyMap = async (storeIds: string[]) => {
  const currencyMap = new Map<string, StoreCurrency>();
  if (!storeIds.length) {
    return currencyMap;
  }

  const candidates = [
    {
      select: "id, store_currency, currency",
      hasStoreCurrency: true,
      hasCurrency: true,
    },
    {
      select: "id, store_currency",
      hasStoreCurrency: true,
      hasCurrency: false,
    },
    {
      select: "id, currency",
      hasStoreCurrency: false,
      hasCurrency: true,
    },
    {
      select: "id",
      hasStoreCurrency: false,
      hasCurrency: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .in("id", storeIds);

    if (!query.error) {
      const rows = ((query.data ?? []) as unknown) as Array<{
        id: string;
        store_currency?: string | null;
        currency?: string | null;
      }>;

      for (const row of rows) {
        const rawCurrency = pickNonEmptyCurrency(
          candidate.hasStoreCurrency ? row.store_currency ?? null : null,
          candidate.hasCurrency ? row.currency ?? null : null
        );
        if (!rawCurrency || !rawCurrency.trim()) {
          continue;
        }
        currencyMap.set(row.id, normalizeCurrency(rawCurrency));
      }

      return currencyMap;
    }

    lastError = query.error.message;

    if (!isMissingAnyColumnError(query.error, ["store_currency", "currency"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastError ?? "stores currency could not be loaded");
};

const loadWebhookCurrencyMap = async (webhookIds: string[]) => {
  const currencyMap = new Map<string, StoreCurrency | null>();
  if (!webhookIds.length) {
    return currencyMap;
  }

  const withCurrency = await supabaseAdmin
    .from("webhook_configs")
    .select("id, currency")
    .in("id", webhookIds);

  if (!withCurrency.error) {
    for (const row of ((withCurrency.data ?? []) as unknown as Array<{ id: string; currency?: string | null }>)) {
      currencyMap.set(row.id, normalizeWebhookCurrency(row.currency ?? null));
    }
    return currencyMap;
  }

  if (!isMissingColumnError(withCurrency.error, "currency")) {
    throw new Error(withCurrency.error.message);
  }

  for (const webhookId of webhookIds) {
    currencyMap.set(webhookId, null);
  }

  return currencyMap;
};

const loadSubscriptions = async () => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, store_id, shop_id, plan, status, created_at, current_period_end, updated_at")
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false });

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, shop_id, plan, status, created_at, current_period_end, updated_at")
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

const loadSchedulerJobs = async () => {
  const candidates = [
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, trigger_type, response_status, error_message, run_at, updated_at, retry_count, created_at",
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, trigger_type, response_status, error_message, run_at, updated_at, created_at",
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, response_status, error_message, run_at, updated_at, created_at",
    "id, subscription_id, idempotency_key, status, response_status, error_message, run_at, updated_at, created_at",
    "id, subscription_id, idempotency_key, status, run_at, created_at",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("scheduler_jobs")
      .select(select)
      .order("run_at", { ascending: false })
      .limit(1000);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        store_id?: string | null;
        subscription_id?: string | null;
        webhook_config_id?: string | null;
        idempotency_key?: string | null;
        status?: string | null;
        trigger_type?: string | null;
        response_status?: number | null;
        error_message?: string | null;
        run_at?: string | null;
        updated_at?: string | null;
        retry_count?: number | null;
        created_at?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        store_id: row.store_id ?? null,
        subscription_id: row.subscription_id ?? null,
        webhook_config_id: row.webhook_config_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        status: row.status ?? null,
        trigger_type: row.trigger_type ?? null,
        response_status: row.response_status ?? null,
        error_message: row.error_message ?? null,
        run_at: row.run_at ?? null,
        updated_at: row.updated_at ?? null,
        retry_count: row.retry_count ?? null,
        created_at: row.created_at ?? null,
      })) as SchedulerJobRow[];
    }

    if (
      !isMissingAnyColumnError(error, [
        "store_id",
        "subscription_id",
        "webhook_config_id",
        "idempotency_key",
        "trigger_type",
        "response_status",
        "error_message",
        "updated_at",
        "retry_count",
      ])
    ) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "scheduler_jobs could not be loaded");
};

const loadAutomationWebhooks = async () => {
  const candidates = [
    "id, name, description, target_url, method, enabled, scope, product_id, currency",
    "id, name, target_url, method, enabled, scope, product_id, currency",
    "id, name, description, target_url, method, enabled, scope, currency",
    "id, name, target_url, method, enabled, scope, currency",
    "id, name, description, target_url, method, enabled, scope, product_id",
    "id, name, target_url, method, enabled, scope, product_id",
    "id, name, description, target_url, method, enabled, scope",
    "id, name, target_url, method, enabled, scope",
    "id, name, description, target_url, method, enabled",
    "id, name, target_url, method, enabled",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const hasScope = select.includes("scope");
    const hasCurrency = select.includes("currency");
    const query = supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .eq("enabled", true)
      .order("name", { ascending: true });

    const scopedQuery = hasScope ? query.or("scope.eq.automation,scope.is.null") : query;
    const { data, error } = await scopedQuery;

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        name: string;
        target_url: string;
        method: string | null;
        enabled: boolean | null;
        scope?: string | null;
        description?: string | null;
        product_id?: string | null;
        currency?: string | null;
      }>;

      const webhookProductMap = await loadWebhookConfigProductMap(rows.map((row) => row.id));
      const webhookCurrencyMap = hasCurrency ? null : await loadWebhookCurrencyMap(rows.map((row) => row.id));

      return rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          target_url: row.target_url,
          method: row.method ?? "POST",
          enabled: row.enabled ?? true,
          scope: row.scope ?? "automation",
          product_id: row.product_id ?? webhookProductMap.get(row.id) ?? null,
          currency: hasCurrency
            ? normalizeWebhookCurrency(row.currency ?? null)
            : webhookCurrencyMap?.get(row.id) ?? null,
        }))
        .filter((row) => !hasScope || row.scope === "automation" || row.scope === null);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "webhook_configs could not be loaded");
};

const loadProducts = async () => {
  const candidates = [
    "id, category_id, title_tr, title_en",
    "id, category_id, title_tr",
    "id, category_id, title",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        category_id?: string | null;
        title_tr?: string | null;
        title_en?: string | null;
        title?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        category_id: row.category_id ?? null,
        title_tr: row.title_tr ?? row.title ?? null,
        title_en: row.title_en ?? row.title_tr ?? row.title ?? null,
      })) as ProductRow[];
    }

    if (!isMissingAnyColumnError(error, ["category_id", "title_tr", "title_en", "title"])) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "products could not be loaded");
};

const loadCategories = async () => {
  const candidates = [
    "id, title_tr, title_en, slug",
    "id, title_tr, slug",
    "id, name, slug",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        title_tr?: string | null;
        title_en?: string | null;
        name?: string | null;
        slug?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        title_tr: row.title_tr ?? row.name ?? row.slug ?? row.id,
        title_en: row.title_en ?? row.title_tr ?? row.name ?? row.slug ?? row.id,
        slug: row.slug ?? null,
      })) as CategoryRow[];
    }

    if (!isMissingAnyColumnError(error, ["title_tr", "title_en", "name", "slug"])) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "categories could not be loaded");
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

    const triggerType: MappingTriggerType = isManualBinding
      ? "manual_switch"
      : isActivationBinding
      ? "activation"
      : "auto_switch";

    const current = mapping.get(storeId) ?? {
      webhookConfigIds: [],
      lastMappedAt: row.created_at ?? null,
      lastTrigger: null,
    };
    if (!current.webhookConfigIds.includes(webhookConfigId)) {
      current.webhookConfigIds.push(webhookConfigId);
    }

    if (!current.lastMappedAt) {
      current.lastMappedAt = row.created_at ?? null;
    }

    if (!current.lastTrigger) {
      current.lastTrigger = {
        status: "success",
        triggerType,
        responseStatus: 200,
        responseStatusLabel: "HTTP 200",
        responseStatusSource: "http",
        errorMessage: null,
        createdAt: row.created_at ?? null,
        webhookConfigId,
      };
    }

    mapping.set(storeId, current);
  }

  return mapping;
};

const parseScheduledStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("scheduled:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 5 ? parts[2] : null;
};

const parseManualStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("manual_switch:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[1] : null;
};

const parseActivationStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("activation:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[2] : null;
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

const getJobTimestamp = (job: SchedulerJobRow) => {
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

const parseIsoToMs = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

type DirectCronSnapshot = {
  webhookConfigId: string | null;
  plan: string | null;
  cadenceHours: number | null;
  nextTriggerAt: string | null;
  lastExecutionAt: string | null;
  lastStatus: number | null;
  verifiedJobId: number | null;
};

type CronLifecycleSnapshot = {
  lastCronSyncAt: string | null;
  lastCronSyncStatus: "success" | "skipped" | "error" | null;
  lastCronSyncMessage: string | null;
};

const loadDirectCronByStoreId = async (storeIds: string[]) => {
  const map = new Map<string, DirectCronSnapshot>();
  if (!storeIds.length) {
    return map;
  }

  try {
    const rows = await loadDirectAutomationCronJobs();
    const storeIdSet = new Set(storeIds);
    const bestByStoreId = new Map<
      string,
      {
        nextExecution: number | null;
        lastExecution: number | null;
        lastStatus: number | null;
        plan: string | null;
        webhookConfigId: string | null;
        verifiedJobId: number | null;
      }
    >();

    for (const row of rows) {
      const storeId = typeof row.storeId === "string" ? row.storeId : null;
      if (!storeId || !storeIdSet.has(storeId)) {
        continue;
      }

      const candidateNextExecution = typeof row.nextExecution === "number" && Number.isFinite(row.nextExecution)
        ? row.nextExecution
        : null;
      const current = bestByStoreId.get(storeId) ?? null;
      if (!current) {
        bestByStoreId.set(storeId, {
          nextExecution: candidateNextExecution,
          lastExecution:
            typeof row.lastExecution === "number" && Number.isFinite(row.lastExecution) ? row.lastExecution : null,
          lastStatus: typeof row.lastStatus === "number" && Number.isFinite(row.lastStatus) ? row.lastStatus : null,
          plan: row.plan ?? null,
          webhookConfigId: row.webhookConfigId ?? null,
          verifiedJobId: row.jobId ?? null,
        });
        continue;
      }

      if (current.nextExecution === null && candidateNextExecution !== null) {
        bestByStoreId.set(storeId, {
          nextExecution: candidateNextExecution,
          lastExecution:
            typeof row.lastExecution === "number" && Number.isFinite(row.lastExecution) ? row.lastExecution : current.lastExecution,
          lastStatus:
            typeof row.lastStatus === "number" && Number.isFinite(row.lastStatus) ? row.lastStatus : current.lastStatus,
          plan: row.plan ?? current.plan ?? null,
          webhookConfigId: row.webhookConfigId ?? current.webhookConfigId ?? null,
          verifiedJobId: row.jobId ?? current.verifiedJobId ?? null,
        });
        continue;
      }

      if (
        current.nextExecution !== null &&
        candidateNextExecution !== null &&
        candidateNextExecution < current.nextExecution
      ) {
        bestByStoreId.set(storeId, {
          nextExecution: candidateNextExecution,
          lastExecution:
            typeof row.lastExecution === "number" && Number.isFinite(row.lastExecution) ? row.lastExecution : current.lastExecution,
          lastStatus:
            typeof row.lastStatus === "number" && Number.isFinite(row.lastStatus) ? row.lastStatus : current.lastStatus,
          plan: row.plan ?? current.plan ?? null,
          webhookConfigId: row.webhookConfigId ?? current.webhookConfigId ?? null,
          verifiedJobId: row.jobId ?? current.verifiedJobId ?? null,
        });
      }
    }

    for (const [storeId, row] of bestByStoreId.entries()) {
      const plan = (row.plan ?? "").trim().toLowerCase() || null;
      const cadenceHours = plan ? getPlanWindowHours(plan) : null;
      const nextTriggerAt = row.nextExecution !== null
        ? new Date(row.nextExecution * 1000).toISOString()
        : null;

      map.set(storeId, {
        webhookConfigId: row.webhookConfigId ?? null,
        plan,
        cadenceHours,
        nextTriggerAt,
        lastExecutionAt:
          row.lastExecution !== null ? new Date(row.lastExecution * 1000).toISOString() : null,
        lastStatus: row.lastStatus ?? null,
        verifiedJobId: row.verifiedJobId ?? null,
      });
    }
  } catch {
    return map;
  }

  return map;
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
      ok: parsed.ok === true,
      status: typeof parsed.status === "string" ? parsed.status : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
    };
  } catch {
    return {
      ok: false,
      status: null,
      message: value,
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
  return {
    lastCronSyncAt: data.created_at ?? null,
    lastCronSyncStatus:
      parsed?.status === "error" ? "error" : parsed?.status === "skipped" ? "skipped" : parsed?.ok ? "success" : "success",
    lastCronSyncMessage: parsed?.message ?? null,
  };
};

const insertCronDirectJobVerifyLog = async (payload: {
  storeId: string;
  webhookConfigId: string | null;
  message: string;
}) => {
  const basePayload = {
    request_url: "admin-stores-automation-overview",
    request_method: "CRON_DIRECT_JOB_VERIFY",
    request_body: {
      store_id: payload.storeId,
      webhook_config_id: payload.webhookConfigId,
      checked_at: new Date().toISOString(),
    },
    response_status: 409,
    response_body: payload.message,
  };

  const attempts: Array<Record<string, unknown>> = [
    { ...basePayload, created_by: null },
    basePayload,
    {
      request_method: "CRON_DIRECT_JOB_VERIFY",
      response_status: 409,
      response_body: payload.message,
    },
  ];

  for (const attemptPayload of attempts) {
    const attempt = await supabaseAdmin.from("webhook_logs").insert(attemptPayload);
    if (!attempt.error) {
      return;
    }

    if (
      !isMissingAnyColumnError(attempt.error, ["request_body", "response_status", "response_body", "created_by"])
    ) {
      return;
    }
  }
};

const getMostRecentCadenceSuccessAt = (jobs: SchedulerJobRow[]) => {
  for (const job of jobs) {
    if ((job.status ?? "").toLowerCase() !== "success") {
      continue;
    }

    if (!(isScheduledJob(job) || isManualSwitchJob(job) || isActivationJob(job))) {
      continue;
    }

    const candidates = [job.run_at, job.updated_at, job.created_at];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  return null;
};

const getLatestScheduledSlotDueMs = (jobs: SchedulerJobRow[]) => {
  let latest = -1;

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

    if (slotDueMs > latest) {
      latest = slotDueMs;
    }
  }

  return latest >= 0 ? latest : null;
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

const computeNextTriggerAt = (args: {
  subscriptionId: string | null | undefined;
  storeId: string;
  plan: string | null | undefined;
  jobs: SchedulerJobRow[];
  nowMs: number;
}) => {
  if (!args.plan) {
    return {
      cadenceHours: null as number | null,
      nextTriggerAt: null as string | null,
      lastCadenceSuccessAt: null as string | null,
    };
  }

  const cadenceHours = getPlanWindowHours(args.plan);
  const cadenceMs = cadenceHours * 60 * 60 * 1000;
  const lastCadenceSuccessAt = getMostRecentCadenceSuccessAt(args.jobs);
  const latestScheduledSlotDueMs = getLatestScheduledSlotDueMs(args.jobs);

  let slotDueMs = (() => {
    if (lastCadenceSuccessAt) {
      return new Date(lastCadenceSuccessAt).getTime() + cadenceMs;
    }

    if (latestScheduledSlotDueMs !== null) {
      return latestScheduledSlotDueMs;
    }

    return args.nowMs;
  })();

  if (args.subscriptionId) {
    let slotDueIso = new Date(slotDueMs).toISOString();
    let slotKey = createScheduledSlotIdempotencyKey({
      subscriptionId: args.subscriptionId,
      storeId: args.storeId,
      plan: args.plan,
      slotDueAtIso: slotDueIso,
    });
    let slotJob = findScheduledSlotJob(args.jobs, args.storeId, slotKey);

    while (
      slotJob &&
      (slotJob.status ?? "").toLowerCase() === "failed" &&
      (slotJob.retry_count ?? 0) >= 5
    ) {
      slotDueMs += cadenceMs;
      slotDueIso = new Date(slotDueMs).toISOString();
      slotKey = createScheduledSlotIdempotencyKey({
        subscriptionId: args.subscriptionId,
        storeId: args.storeId,
        plan: args.plan,
        slotDueAtIso: slotDueIso,
      });
      slotJob = findScheduledSlotJob(args.jobs, args.storeId, slotKey);
    }

    if (slotJob && (slotJob.status ?? "").toLowerCase() === "failed") {
      const retryCount = slotJob.retry_count ?? 0;
      if (retryCount < 5) {
        slotDueMs = getJobTimestamp(slotJob) + getRetryDelayMinutes(retryCount) * 60 * 1000;
      } else {
        slotDueMs += cadenceMs;
      }
    }
  }

  return {
    cadenceHours,
    nextTriggerAt: new Date(slotDueMs).toISOString(),
    lastCadenceSuccessAt,
  };
};

const loadListingCounts = async (storeIds: string[]): Promise<Map<string, number>> => {
  if (storeIds.length === 0) {
    return new Map();
  }

  const pageSize = 1000;
  const maxRows = 50000;
  const counts = new Map<string, number>();
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const query = await supabaseAdmin
      .from("listing")
      .select("client_id")
      .in("client_id", storeIds)
      .range(from, to);

    if (query.error) {
      break;
    }

    const page = (query.data ?? []) as Array<{ client_id?: string | null }>;
    for (const row of page) {
      const id = (row.client_id ?? "").trim();
      if (id) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return counts;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const [
      { rows: stores },
      subscriptions,
      webhooks,
      schedulerJobs,
      products,
      categories,
    ] = await Promise.all([
      loadStores(),
      loadSubscriptions(),
      loadAutomationWebhooks(),
      loadSchedulerJobs(),
      loadProducts(),
      loadCategories(),
    ]);

    const storeIds = stores.map((store) => store.id);

    const cronLifecycleSnapshotPromise = loadLatestCronLifecycleSnapshot();
    const [storeCurrencyById, storeWebhookMappingFallback, listingCountByStoreId] = await Promise.all([
      loadStoreCurrencyMap(storeIds),
      loadStoreWebhookMappingsFromLogs(storeIds),
      loadListingCounts(storeIds),
    ]);
    const directCronByStoreId = await loadDirectCronByStoreId(storeIds);
    const cronLifecycleSnapshot = await cronLifecycleSnapshotPromise;

    const userIds = Array.from(new Set(stores.map((store) => store.user_id)));
    const profiles = await loadProfiles(userIds);

    const profileByUserId = new Map<string, ProfileRow>(profiles.map((profile) => [profile.user_id, profile]));
    const categoriesById = new Map(
      categories.map((category) => [category.id, { tr: category.title_tr, en: category.title_en }])
    );
    const productsById = new Map(
      products.map((product) => {
        const category = product.category_id ? categoriesById.get(product.category_id) : null;
        const labelTr = [category?.tr, product.title_tr].filter(Boolean).join(" / ");
        const labelEn = [category?.en, product.title_en].filter(Boolean).join(" / ");
        return [
          product.id,
          {
            ...product,
            labelTr: labelTr || product.title_tr || product.id,
            labelEn: labelEn || product.title_en || product.title_tr || product.id,
          },
        ];
      })
    );
    const productCandidates: ProductMatchCandidate[] = Array.from(productsById.values()).map((product) => {
      const category = product.category_id ? categoriesById.get(product.category_id) : null;
      return {
        id: product.id,
        titleTr: product.title_tr,
        titleEn: product.title_en,
        categoryTitleTr: category?.tr ?? null,
        categoryTitleEn: category?.en ?? null,
        labelTr: product.labelTr,
        labelEn: product.labelEn,
      };
    });
    const subscriptionByStoreId = new Map<string, SubscriptionRow>();
    const storeIdBySubscriptionId = new Map<string, string>();
    const latestJobByStoreId = new Map<string, SchedulerJobRow>();
    const jobsByStoreId = new Map<string, SchedulerJobRow[]>();
    const webhookById = new Map<string, WebhookConfigRow>(webhooks.map((webhook) => [webhook.id, webhook]));
    const activeWebhookIds = new Set(webhooks.map((webhook) => webhook.id));
    const nowMs = Date.now();

    for (const subscription of subscriptions) {
      const resolvedStoreId = subscription.store_id ?? (subscription.shop_id && isUuid(subscription.shop_id) ? subscription.shop_id : null);
      if (!resolvedStoreId) {
        continue;
      }

      storeIdBySubscriptionId.set(subscription.id, resolvedStoreId);

      if (!subscriptionByStoreId.has(resolvedStoreId)) {
        subscriptionByStoreId.set(resolvedStoreId, subscription);
      }
    }

    for (const job of schedulerJobs) {
      const resolvedStoreId =
        resolveStoreIdForJob(job) ??
        (job.subscription_id ? storeIdBySubscriptionId.get(job.subscription_id) ?? null : null);

      if (!resolvedStoreId) {
        continue;
      }

      if (!jobsByStoreId.has(resolvedStoreId)) {
        jobsByStoreId.set(resolvedStoreId, []);
      }
      jobsByStoreId.get(resolvedStoreId)?.push(job);

      if (!latestJobByStoreId.has(resolvedStoreId)) {
        latestJobByStoreId.set(resolvedStoreId, job);
      }
    }

    for (const jobs of jobsByStoreId.values()) {
      jobs.sort((a, b) => getJobTimestamp(b) - getJobTimestamp(a));
    }

    const rows = stores.map((store) => {
      const profile = profileByUserId.get(store.user_id);
      const activeSubscription = subscriptionByStoreId.get(store.id) ?? null;
      const monthIndex = getSubscriptionMonthIndex(activeSubscription?.created_at ?? null);
      const canSwitch = Boolean(activeSubscription);
      const lastJob = latestJobByStoreId.get(store.id) ?? null;
      const storeJobs = jobsByStoreId.get(store.id) ?? [];
      const directCronSnapshot = directCronByStoreId.get(store.id) ?? null;
      const mappingSnapshot = storeWebhookMappingFallback.get(store.id) ?? null;
      const storeCurrency = storeCurrencyById.get(store.id) ?? "USD";
      const hasStoreCurrency = storeCurrencyById.has(store.id);
      const resolvedStoreProductCandidate =
        (store.product_id ? productsById.get(store.product_id) ?? null : null) ??
        resolveProductCandidateForCategory(store.category, productCandidates);
      const effectiveStoreProductId = resolvedStoreProductCandidate?.id ?? store.product_id ?? null;
      const storeProduct = effectiveStoreProductId ? productsById.get(effectiveStoreProductId) ?? resolvedStoreProductCandidate : null;
      const resolveCompatibleWebhookId = (candidateIds: Array<string | null | undefined>) => {
        for (const candidateId of candidateIds) {
          if (!candidateId || !activeWebhookIds.has(candidateId)) {
            continue;
          }

          const webhook = webhookById.get(candidateId);
          if (!webhook) {
            continue;
          }

          if (
            !isWebhookCompatibleWithStore({
              storeProductId: effectiveStoreProductId,
              storeCurrency,
              storeCurrencyKnown: hasStoreCurrency,
              webhookProductId: webhook.product_id,
              webhookCurrency: webhook.currency,
            })
          ) {
            continue;
          }

          return candidateId;
        }

        return null;
      };
      const explicitActiveWebhookId =
        store.active_webhook_config_id && activeWebhookIds.has(store.active_webhook_config_id)
          ? store.active_webhook_config_id
          : null;
      const activeWebhookConfigId =
        explicitActiveWebhookId ??
        resolveCompatibleWebhookId(mappingSnapshot?.webhookConfigIds ?? []);
      const activeWebhook = activeWebhookConfigId ? webhookById.get(activeWebhookConfigId) ?? null : null;
      const eligibleWebhooks = webhooks;
      const eligibleWebhookConfigIds = eligibleWebhooks.map((webhook) => webhook.id);
      const scheduleState = computeNextTriggerAt({
        subscriptionId: activeSubscription?.id,
        storeId: store.id,
        plan: activeSubscription?.plan ?? directCronSnapshot?.plan ?? null,
        jobs: storeJobs,
        nowMs,
      });
      const lastTriggerFromJob = lastJob
        ? {
            status: lastJob.status,
            triggerType: isScheduledJob(lastJob) ? "auto_switch" : lastJob.trigger_type,
            responseStatus: lastJob.response_status,
            responseStatusLabel:
              lastJob.response_status !== null && lastJob.response_status !== undefined
                ? `HTTP ${lastJob.response_status}`
                : null,
            responseStatusSource: "http",
            errorMessage: lastJob.error_message,
            createdAt: lastJob.run_at ?? lastJob.created_at,
            webhookConfigId: lastJob.webhook_config_id,
          }
        : null;
      const lastTriggerFromMapping = mappingSnapshot?.lastTrigger ?? null;
      const directCronStatus = describeCronJobOrgExecutionStatus(directCronSnapshot?.lastStatus);
      const lastTriggerFromDirectCron =
        directCronSnapshot?.lastExecutionAt
          ? {
              status: directCronStatus.state,
              triggerType: "auto_switch",
              responseStatus: directCronSnapshot.lastStatus,
              responseStatusLabel: `cron-job.org ${directCronStatus.label}${
                directCronSnapshot.lastStatus !== null ? ` (${directCronSnapshot.lastStatus})` : ""
              }`,
              responseStatusSource: "cron-job.org",
              errorMessage: directCronStatus.state === "failed" ? `cron-job.org ${directCronStatus.label}` : null,
              createdAt: directCronSnapshot.lastExecutionAt,
              webhookConfigId: directCronSnapshot.webhookConfigId,
            }
          : null;
      const lastTrigger =
        [lastTriggerFromJob, lastTriggerFromMapping, lastTriggerFromDirectCron]
          .filter((trigger): trigger is NonNullable<typeof lastTriggerFromJob> => Boolean(trigger))
          .sort((left, right) => parseIsoToMs(right.createdAt ?? null) - parseIsoToMs(left.createdAt ?? null))[0] ?? null;
      const usesPerStoreDirectCron = isDirectAutomationMode() && isPerStoreDirectCronEnabled();
      const directCronPresent = usesPerStoreDirectCron
        ? Boolean(directCronSnapshot?.verifiedJobId)
        : Boolean(activeSubscription?.id && activeWebhookConfigId);
      const cadenceHours =
        usesPerStoreDirectCron && directCronPresent
          ? directCronSnapshot?.cadenceHours ?? scheduleState.cadenceHours
          : scheduleState.cadenceHours;
      const nextTriggerAt =
        usesPerStoreDirectCron && directCronPresent
          ? directCronSnapshot?.nextTriggerAt ?? scheduleState.nextTriggerAt
          : scheduleState.nextTriggerAt;

      return {
        storeId: store.id,
        storeName: store.store_name,
        storeStatus: store.status ?? "pending",
        category: store.category,
        storeCurrency,
        storeCurrencyKnown: hasStoreCurrency,
        userId: store.user_id,
        userLabel:
          profile?.full_name?.trim() ||
          profile?.email?.trim() ||
          `${store.user_id.slice(0, 8)}...`,
        productId: effectiveStoreProductId,
        productLabel: storeProduct?.labelTr ?? null,
        eligibleWebhookConfigIds,
        subscriptionId: activeSubscription?.id ?? null,
        subscriptionStatus: activeSubscription?.status ?? null,
        plan: activeSubscription?.plan ?? directCronSnapshot?.plan ?? null,
        currentPeriodEnd: activeSubscription?.current_period_end ?? null,
        monthIndex,
        canSwitch,
        minMonthRequired: 1,
        eligibilityReason: !activeSubscription ? "active_subscription_required" : null,
        activeWebhookConfigId,
        activeWebhookName: activeWebhook?.name ?? null,
        automationUpdatedAt: store.automation_updated_at ?? mappingSnapshot?.lastMappedAt ?? null,
        cadenceHours,
        nextTriggerAt,
        directCronPresent,
        directCronJobId: directCronSnapshot?.verifiedJobId ?? null,
        lastCronSyncAt: cronLifecycleSnapshot.lastCronSyncAt,
        lastCronSyncStatus: cronLifecycleSnapshot.lastCronSyncStatus,
        lastCronSyncMessage: cronLifecycleSnapshot.lastCronSyncMessage,
        lastCadenceSuccessAt: scheduleState.lastCadenceSuccessAt,
        lastTrigger,
        listingCount: listingCountByStoreId.get(store.id) ?? 0,
      };
    });

    if (isDirectAutomationMode() && isPerStoreDirectCronEnabled()) {
      const missingDirectCronRows = rows.filter((row) => {
        return Boolean(row.subscriptionId && row.activeWebhookConfigId && row.directCronPresent !== true);
      });

      if (missingDirectCronRows.length > 0) {
        for (const row of missingDirectCronRows.slice(0, 10)) {
          await insertCronDirectJobVerifyLog({
            storeId: row.storeId,
            webhookConfigId: row.activeWebhookConfigId,
            message: "Eligible direct automation cron job bulunamadi. Lifecycle reconcile tetiklendi.",
          });
        }

        await syncSchedulerCronJobLifecycle().catch(() => null);
      }
    }

    return NextResponse.json({
      rows,
      webhookOptions: webhooks.map((webhook) => ({
        id: webhook.id,
        name: webhook.name,
        description: webhook.description,
        targetUrl: webhook.target_url,
        method: webhook.method,
        enabled: webhook.enabled ?? true,
        productId: webhook.product_id,
        currency: webhook.currency,
        productLabel: webhook.product_id ? productsById.get(webhook.product_id)?.labelTr ?? null : null,
      })),
      products: Array.from(productsById.values()).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        titleTr: item.title_tr,
        titleEn: item.title_en,
        labelTr: item.labelTr,
        labelEn: item.labelEn,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation overview could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
