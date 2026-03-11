import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getSubscriptionMonthIndex } from "@/lib/admin/automation";
import {
  loadSchedulerMasterState,
  syncSchedulerCronJobLifecycle,
  type SchedulerCronSyncResult,
} from "@/lib/cron-job-org/client";
import { buildN8nTriggerPayload, dispatchN8nTrigger } from "@/lib/n8n/client";
import { serverEnv } from "@/lib/env/server";
import { createManualSwitchIdempotencyKey } from "@/lib/scheduler/idempotency";
import {
  resolveProductCandidateForCategory,
  type ProductMatchCandidate,
} from "@/lib/stores/product-resolution";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

type StoreRow = {
  id: string;
  user_id: string;
  product_id?: string | null;
  active_webhook_config_id?: string | null;
  category?: string | null;
  store_currency: "USD" | "TRY";
  store_currency_known?: boolean;
};

type SubscriptionRow = {
  id: string;
  plan: string;
  status: string;
  created_at: string | null;
  current_period_end: string | null;
  store_id?: string | null;
  shop_id?: string | null;
};

type WebhookConfigRow = {
  id: string;
  name: string;
  target_url: string;
  method: string | null;
  headers: Record<string, unknown> | null;
  enabled: boolean | null;
  product_id?: string | null;
  currency?: "USD" | "TRY" | null;
  scope?: string | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingTableError = (error: { message?: string } | null | undefined, tableName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  const table = tableName.toLowerCase();
  return (
    (message.includes("relation") && message.includes(table)) ||
    (message.includes("could not find the table") && message.includes(table))
  );
};

const isMissingAnyColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const normalizeStoreCurrency = (value: string | null | undefined) => {
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

const normalizeWebhookCurrency = (value: string | null | undefined) => {
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
    return "USD";
  }

  return null;
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

const mapPgCronStatusCode = (value: string | null | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "succeeded" || normalized === "success") {
    return 1;
  }

  return 2;
};

const isUniqueViolation = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "23505" ||
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("scheduler_jobs_idempotency_key_key")
  );
};

const insertSchedulerJobWithFallback = async (args: {
  subscriptionId: string;
  userId: string;
  storeId: string;
  webhookConfigId: string;
  plan: string;
  idempotencyKey: string;
  runAt: string;
  requestPayload?: Record<string, unknown> | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      trigger_type: "manual_switch",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      request_payload: args.requestPayload ?? { client_id: args.storeId },
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      trigger_type: "manual_switch",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: "processing",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const attempt = await supabaseAdmin
      .from("scheduler_jobs")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!attempt.error) {
      return { id: attempt.data?.id ?? null, error: null as string | null };
    }

    if (isUniqueViolation(attempt.error)) {
      const existing = await supabaseAdmin
        .from("scheduler_jobs")
        .select("id, status")
        .eq("idempotency_key", args.idempotencyKey)
        .limit(1)
        .maybeSingle<{ id: string; status: string }>();

      if (existing.error) {
        return { id: null, error: existing.error.message };
      }

      if (!existing.data?.id) {
        return { id: null, error: "Aynı idempotency_key ile job zaten var fakat okunamadı." };
      }

      const existingStatus = (existing.data.status ?? "").toLowerCase();
      if (existingStatus === "processing" || existingStatus === "success") {
        return { id: null, error: "Aynı geçiş isteği bu dakika içinde zaten işlendi." };
      }

      // failed/skipped vb. durumlarda aynı key ile mevcut kaydı retry için yeniden kullan.
      return { id: existing.data.id, error: null as string | null };
    }

    const toleratedMissingColumn = isMissingAnyColumnError(attempt.error, [
      "request_payload",
      "trigger_type",
      "webhook_config_id",
      "store_id",
    ]);

    if (!toleratedMissingColumn) {
      return { id: null, error: attempt.error.message };
    }

    lastError = attempt.error.message;
  }

  return { id: null, error: lastError ?? "scheduler_jobs insert failed" };
};

const updateSchedulerJobWithFallback = async (jobId: string, patch: {
  status: string;
  responseStatus?: number | null;
  responsePayload?: string | null;
  errorMessage?: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
    },
    {
      status: patch.status,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("scheduler_jobs").update(payload).eq("id", jobId);
    if (!attempt.error) {
      return;
    }

    const toleratedMissingColumn = isMissingAnyColumnError(attempt.error, [
      "response_status",
      "response_payload",
      "error_message",
      "updated_at",
    ]);

    if (!toleratedMissingColumn) {
      throw new Error(attempt.error.message);
    }
  }
};

const loadActiveSubscriptionForStore = async (storeId: string) => {
  const stripeMode = serverEnv.STRIPE_MODE;
  const candidates = [
    {
      select: "id, plan, status, created_at, current_period_end, store_id, stripe_mode",
      filterColumn: "store_id",
      hasStripeMode: true,
    },
    {
      select: "id, plan, status, created_at, current_period_end, shop_id, stripe_mode",
      filterColumn: "shop_id",
      hasStripeMode: true,
    },
    {
      select: "id, plan, status, created_at, current_period_end, store_id",
      filterColumn: "store_id",
      hasStripeMode: false,
    },
    {
      select: "id, plan, status, created_at, current_period_end, shop_id",
      filterColumn: "shop_id",
      hasStripeMode: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("subscriptions")
      .select(candidate.select)
      .eq(candidate.filterColumn, storeId)
      .in("status", ["active", "trialing"])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (candidate.hasStripeMode) {
      query = query.or(`stripe_mode.eq.${stripeMode},stripe_mode.is.null`);
    }

    const attempt = await query.maybeSingle<SubscriptionRow>();
    if (!attempt.error) {
      return attempt.data;
    }

    lastError = attempt.error.message;
    if (!isMissingAnyColumnError(attempt.error, ["store_id", "shop_id", "stripe_mode"])) {
      throw new Error(attempt.error.message);
    }
  }

  if (lastError) {
    throw new Error(lastError);
  }

  return null;
};

const ensureSubscriptionStoreBinding = async (args: {
  subscriptionId: string;
  storeId: string;
  nowIso: string;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    { store_id: args.storeId, shop_id: args.storeId, updated_at: args.nowIso },
    { store_id: args.storeId, shop_id: args.storeId },
    { store_id: args.storeId, updated_at: args.nowIso },
    { store_id: args.storeId },
    { shop_id: args.storeId, updated_at: args.nowIso },
    { shop_id: args.storeId },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("subscriptions").update(payload).eq("id", args.subscriptionId);
    if (!attempt.error) {
      return { error: null as string | null };
    }

    if (!isMissingAnyColumnError(attempt.error, ["store_id", "shop_id", "updated_at"])) {
      return { error: attempt.error.message };
    }

    lastError = attempt.error.message;
  }

  return { error: lastError };
};

const loadWebhookConfig = async (id: string) => {
  const candidates = [
    "id, name, target_url, method, headers, enabled, scope, product_id, currency",
    "id, name, target_url, method, headers, enabled, scope, product_id",
    "id, name, target_url, method, headers, enabled, product_id, currency",
    "id, name, target_url, method, headers, enabled, product_id",
    "id, name, target_url, method, headers, enabled, currency",
    "id, name, target_url, method, headers, enabled",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const query = await supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .eq("id", id)
      .maybeSingle<{
        id: string;
        name: string;
        target_url: string;
        method?: string | null;
        headers?: Record<string, unknown> | null;
        enabled?: boolean | null;
        scope?: string | null;
        product_id?: string | null;
        currency?: string | null;
      }>();

    if (!query.error) {
      if (!query.data) {
        return null;
      }

      const map = query.data.product_id ? null : await loadWebhookConfigProductMap([query.data.id]);

      return {
        id: query.data.id,
        name: query.data.name,
        target_url: query.data.target_url,
        method: query.data.method ?? "POST",
        headers: query.data.headers ?? {},
        enabled: query.data.enabled ?? true,
        scope: query.data.scope ?? "automation",
        product_id: query.data.product_id ?? map?.get(query.data.id) ?? null,
        currency: normalizeWebhookCurrency(query.data.currency ?? null),
      } satisfies WebhookConfigRow;
    }

    lastError = query.error.message;
    if (!isMissingAnyColumnError(query.error, ["scope", "product_id", "currency"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastError ?? "webhook config could not be loaded");
};

const loadStoreById = async (storeId: string) => {
  const candidates = [
    {
      select: "id, user_id, product_id, active_webhook_config_id, category, store_currency, currency",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: true,
      hasCurrencyColumn: true,
    },
    {
      select: "id, user_id, product_id, active_webhook_config_id, category, store_currency",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: true,
      hasCurrencyColumn: false,
    },
    {
      select: "id, user_id, product_id, active_webhook_config_id, category, currency",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: false,
      hasCurrencyColumn: true,
    },
    {
      select: "id, user_id, product_id, active_webhook_config_id, category",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: false,
      hasCurrencyColumn: false,
    },
    {
      select: "id, user_id, active_webhook_config_id, category, store_currency, currency",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: true,
      hasCurrencyColumn: true,
    },
    {
      select: "id, user_id, active_webhook_config_id, category, store_currency",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: true,
      hasCurrencyColumn: false,
    },
    {
      select: "id, user_id, active_webhook_config_id, category, currency",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: false,
      hasCurrencyColumn: true,
    },
    {
      select: "id, user_id, product_id, category",
      hasProductColumn: true,
      hasActiveWebhookColumn: false,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: false,
      hasCurrencyColumn: false,
    },
    {
      select: "id, user_id, category",
      hasProductColumn: false,
      hasActiveWebhookColumn: false,
      hasCategoryColumn: true,
      hasStoreCurrencyColumn: false,
      hasCurrencyColumn: false,
    },
  ] as const;

  let lastErrorMessage: string | null = null;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("id", storeId)
      .maybeSingle<{
        id: string;
        user_id: string;
        product_id?: string | null;
        active_webhook_config_id?: string | null;
        category?: string | null;
        store_currency?: string | null;
        currency?: string | null;
      }>();

    if (!query.error) {
      if (!query.data) {
        return { data: null, error: null as string | null };
      }

      const rawStoreCurrency = pickNonEmptyCurrency(
        candidate.hasStoreCurrencyColumn ? query.data.store_currency ?? null : null,
        candidate.hasCurrencyColumn ? query.data.currency ?? null : null
      );
      const storeCurrencyKnown = Boolean(rawStoreCurrency && rawStoreCurrency.trim());

      return {
        data: {
          id: query.data.id,
          user_id: query.data.user_id,
          product_id: candidate.hasProductColumn ? query.data.product_id ?? null : null,
          active_webhook_config_id: candidate.hasActiveWebhookColumn ? query.data.active_webhook_config_id ?? null : null,
          category: candidate.hasCategoryColumn ? query.data.category ?? null : null,
          store_currency: normalizeStoreCurrency(rawStoreCurrency),
          store_currency_known: storeCurrencyKnown,
        } as StoreRow,
        error: null as string | null,
      };
    }

    lastErrorMessage = query.error.message;

    const recoverable = isMissingAnyColumnError(query.error, [
      "product_id",
      "active_webhook_config_id",
      "category",
      "store_currency",
      "currency",
    ]);
    if (!recoverable) {
      return { data: null, error: query.error.message };
    }
  }

  return { data: null, error: lastErrorMessage ?? "stores row could not be loaded" };
};

const loadProductMatchCandidates = async (): Promise<ProductMatchCandidate[]> => {
  const categoryRows = await supabaseAdmin
    .from("categories")
    .select("id,title_tr,title_en")
    .limit(5000);

  if (categoryRows.error) {
    throw new Error(categoryRows.error.message);
  }

  const categoriesById = new Map(
    ((categoryRows.data ?? []) as Array<{ id: string; title_tr?: string | null; title_en?: string | null }>).map((row) => [
      row.id,
      {
        tr: row.title_tr ?? null,
        en: row.title_en ?? null,
      },
    ])
  );

  const productRows = await supabaseAdmin
    .from("products")
    .select("id,category_id,title_tr,title_en")
    .limit(5000);

  if (productRows.error) {
    throw new Error(productRows.error.message);
  }

  return ((productRows.data ?? []) as Array<{
    id: string;
    category_id?: string | null;
    title_tr?: string | null;
    title_en?: string | null;
  }>).map((row) => {
    const category = row.category_id ? categoriesById.get(row.category_id) : null;
    const labelTr = [category?.tr, row.title_tr ?? null].filter(Boolean).join(" / ");
    const labelEn = [category?.en, row.title_en ?? null].filter(Boolean).join(" / ");

    return {
      id: row.id,
      titleTr: row.title_tr ?? null,
      titleEn: row.title_en ?? null,
      categoryTitleTr: category?.tr ?? null,
      categoryTitleEn: category?.en ?? null,
      labelTr: labelTr || null,
      labelEn: labelEn || null,
    } satisfies ProductMatchCandidate;
  });
};

const persistFallbackStoreWebhookMapping = async (args: {
  storeId: string;
  webhookConfigId: string;
  createdBy: string;
  idempotencyKey: string;
}) => {
  await supabaseAdmin.from("webhook_logs").insert({
    request_url: "store-webhook-mapping",
    request_method: "STORE_WEBHOOK_MAP",
    request_headers: {},
    request_body: {
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      idempotency_key: args.idempotencyKey,
    },
    response_status: 200,
    response_body: "mapping_saved",
    duration_ms: 0,
    created_by: args.createdBy,
  });
};

const persistCronVerificationLog = async (args: {
  storeId: string;
  webhookConfigId: string;
  webhookName: string;
  schedulerMessage: string;
  verifiedJobId: number | null;
  nextExecutionUnix: number | null;
  lastExecutionUnix: number | null;
  lastStatus: number | null;
  createdBy: string;
}) => {
  const responseBody = JSON.stringify({
    scheduler_message: args.schedulerMessage,
    store_id: args.storeId,
    webhook_config_id: args.webhookConfigId,
    webhook_name: args.webhookName,
    verified_job_id: args.verifiedJobId,
    next_execution_unix: args.nextExecutionUnix,
    next_execution_at:
      args.nextExecutionUnix !== null ? new Date(args.nextExecutionUnix * 1000).toISOString() : null,
    last_execution_unix: args.lastExecutionUnix,
    last_execution_at:
      args.lastExecutionUnix !== null ? new Date(args.lastExecutionUnix * 1000).toISOString() : null,
    last_status: args.lastStatus,
  });

  const payloads: Array<Record<string, unknown>> = [
    {
      request_url: "store-webhook-cron-sync",
      request_method: "STORE_WEBHOOK_CRON_SYNC",
      request_headers: {},
      request_body: {
        store_id: args.storeId,
        webhook_config_id: args.webhookConfigId,
        webhook_name: args.webhookName,
        verified_job_id: args.verifiedJobId,
      },
      response_status: 200,
      response_body: responseBody,
      duration_ms: 0,
      created_by: args.createdBy,
    },
    {
      request_url: "store-webhook-cron-sync",
      request_method: "STORE_WEBHOOK_CRON_SYNC",
      request_body: {
        store_id: args.storeId,
        webhook_config_id: args.webhookConfigId,
        webhook_name: args.webhookName,
        verified_job_id: args.verifiedJobId,
      },
      response_status: 200,
      response_body: responseBody,
      duration_ms: 0,
      created_by: args.createdBy,
    },
    {
      request_url: "store-webhook-cron-sync",
      request_method: "STORE_WEBHOOK_CRON_SYNC",
      response_status: 200,
      response_body: responseBody,
      duration_ms: 0,
      created_by: args.createdBy,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("webhook_logs").insert(payload);
    if (!attempt.error) {
      return;
    }

    if (
      !isMissingAnyColumnError(attempt.error, [
        "request_headers",
        "request_body",
        "response_status",
        "response_body",
        "duration_ms",
        "created_by",
      ])
    ) {
      return;
    }
  }
};

const updateStoreAutomationBindingWithFallback = async (args: {
  storeId: string;
  webhookConfigId: string;
  productId: string | null;
  category: string | null;
  nowIso: string;
  updatedBy: string;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      product_id: args.productId,
      category: args.category,
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
      automation_updated_by: args.updatedBy,
    },
    {
      category: args.category,
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
      automation_updated_by: args.updatedBy,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
    },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const update = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);

    if (!update.error) {
      return { error: null as string | null };
    }

    const recoverable = isMissingAnyColumnError(update.error, [
      "product_id",
      "category",
      "active_webhook_config_id",
      "automation_updated_at",
      "automation_updated_by",
    ]);

    if (!recoverable) {
      return { error: update.error.message };
    }

    lastError = update.error.message;
  }

  return { error: lastError };
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const { id: storeId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    targetWebhookConfigId?: string;
  };
  const targetWebhookConfigId = body.targetWebhookConfigId?.trim();

  if (!targetWebhookConfigId) {
    return NextResponse.json({ error: "targetWebhookConfigId is required" }, { status: 400 });
  }

  try {
    const { data: store, error: storeError } = await loadStoreById(storeId);

    if (storeError) {
      return NextResponse.json({ error: storeError }, { status: 500 });
    }

    if (!store) {
      return notFoundResponse();
    }

    const activeSubscription = await loadActiveSubscriptionForStore(store.id);

    if (!activeSubscription) {
      return NextResponse.json({ error: "Aktif veya deneme aboneliği bulunamadı." }, { status: 400 });
    }

    const monthIndex = getSubscriptionMonthIndex(activeSubscription.created_at);

    const targetWebhook = await loadWebhookConfig(targetWebhookConfigId);

    if (!targetWebhook) {
      return NextResponse.json(
        {
          code: "WEBHOOK_NOT_FOUND",
          message: "Hedef webhook bulunamadı.",
          error: "Hedef webhook bulunamadı.",
        },
        { status: 404 }
      );
    }

    if (!targetWebhook.enabled) {
      return NextResponse.json(
        {
          code: "WEBHOOK_DISABLED",
          message: `Hedef webhook pasif durumda: ${targetWebhook.name} (${targetWebhook.id}).`,
          error: "Hedef webhook pasif durumda.",
        },
        { status: 400 }
      );
    }

    if (targetWebhook.scope && targetWebhook.scope !== "automation") {
      return NextResponse.json(
        {
          code: "WEBHOOK_SCOPE_INVALID",
          message: `Hedef webhook automation scope'unda değil: ${targetWebhook.name} (${targetWebhook.id}).`,
          error: "Hedef webhook scope=automation olmalı.",
        },
        { status: 400 }
      );
    }

    const productMatchCandidates = await loadProductMatchCandidates();
    const resolvedStoreProductCandidate =
      (store.product_id
        ? productMatchCandidates.find((candidate) => candidate.id === store.product_id) ?? null
        : null) ?? resolveProductCandidateForCategory(store.category ?? null, productMatchCandidates);
    const effectiveStoreProductId = resolvedStoreProductCandidate?.id ?? store.product_id ?? null;
    const effectiveProductId = targetWebhook.product_id ?? effectiveStoreProductId ?? null;
    const targetProductCandidate = effectiveProductId
      ? productMatchCandidates.find((candidate) => candidate.id === effectiveProductId) ?? null
      : null;
    const effectiveCategory =
      targetProductCandidate?.labelTr ??
      targetProductCandidate?.labelEn ??
      store.category ??
      null;

    const idempotencyKey = createManualSwitchIdempotencyKey(store.id, targetWebhook.id);
    const existingJob = await supabaseAdmin
      .from("scheduler_jobs")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; status: string }>();

    if (existingJob.data && ["processing", "success"].includes(existingJob.data.status)) {
      return NextResponse.json(
        {
          code: "MANUAL_SWITCH_DUPLICATE",
          message: "Aynı geçiş isteği bu dakika içinde zaten işlendi.",
          error: "Aynı geçiş isteği bu dakika içinde zaten işlendi.",
          idempotencyKey,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const subscriptionBindingRepair = await ensureSubscriptionStoreBinding({
      subscriptionId: activeSubscription.id,
      storeId: store.id,
      nowIso,
    });

    if (subscriptionBindingRepair.error && !isMissingAnyColumnError({ message: subscriptionBindingRepair.error }, ["store_id", "shop_id", "updated_at"])) {
      return NextResponse.json({ error: subscriptionBindingRepair.error }, { status: 500 });
    }

    const transitionInsert = await supabaseAdmin
      .from("store_automation_transitions")
      .insert({
        store_id: store.id,
        subscription_id: activeSubscription.id,
        from_webhook_config_id: store.active_webhook_config_id,
        to_webhook_config_id: targetWebhook.id,
        month_index: monthIndex,
        status: "processing",
        created_by: admin.user.id,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (transitionInsert.error && !isMissingTableError(transitionInsert.error, "store_automation_transitions")) {
      return NextResponse.json({ error: transitionInsert.error.message }, { status: 500 });
    }

    const transitionId = transitionInsert.data?.id ?? null;

    const storeUpdate = await updateStoreAutomationBindingWithFallback({
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      productId: effectiveProductId,
      category: effectiveCategory,
      nowIso,
      updatedBy: admin.user.id,
    });

    if (storeUpdate.error && !isMissingAnyColumnError({ message: storeUpdate.error }, ["product_id", "active_webhook_config_id", "automation_updated_at", "automation_updated_by"])) {
      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: storeUpdate.error,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({ error: storeUpdate.error }, { status: 500 });
    }

    // Legacy schema fallback: scheduler can read latest mapping from webhook_logs when stores mapping columns do not exist.
    await persistFallbackStoreWebhookMapping({
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      createdBy: admin.user.id,
      idempotencyKey,
    });
    let cronSync: SchedulerCronSyncResult = {
      ok: true,
      status: "noop",
      message: "Supabase pg_cron master scheduler kullanılıyor.",
    };
    let directCronVerification:
      | {
          jobId: number;
          nextExecution: number | null;
          lastExecution: number | null;
          lastStatus: number | null;
        }
      | null = null;
    let cronWarning: string | null = null;
    cronSync = await syncSchedulerCronJobLifecycle({ force: true });

    if (!cronSync.ok) {
      cronWarning = cronSync.details ?? cronSync.message;
      await persistCronVerificationLog({
        storeId: store.id,
        webhookConfigId: targetWebhook.id,
        webhookName: targetWebhook.name,
        schedulerMessage: cronWarning,
        verifiedJobId: null,
        nextExecutionUnix: null,
        lastExecutionUnix: null,
        lastStatus: null,
        createdBy: admin.user.id,
      });
    } else {
      const schedulerState = await loadSchedulerMasterState().catch(() => null);

      if (!schedulerState?.jobId || schedulerState.active !== true) {
        cronWarning = "Supabase pg_cron master scheduler henüz aktif görünmüyor.";
        await persistCronVerificationLog({
          storeId: store.id,
          webhookConfigId: targetWebhook.id,
          webhookName: targetWebhook.name,
          schedulerMessage: cronWarning,
          verifiedJobId: null,
          nextExecutionUnix: null,
          lastExecutionUnix: null,
          lastStatus: null,
          createdBy: admin.user.id,
        });
      } else {
        directCronVerification = {
          jobId: schedulerState.jobId,
          nextExecution: null,
          lastExecution: toUnixSeconds(schedulerState.lastRunStartedAt),
          lastStatus: mapPgCronStatusCode(schedulerState.lastRunStatus),
        };

        await persistCronVerificationLog({
          storeId: store.id,
          webhookConfigId: targetWebhook.id,
          webhookName: targetWebhook.name,
          schedulerMessage: cronSync.message,
          verifiedJobId: schedulerState.jobId,
          nextExecutionUnix: null,
          lastExecutionUnix: toUnixSeconds(schedulerState.lastRunStartedAt),
          lastStatus: mapPgCronStatusCode(schedulerState.lastRunStatus),
          createdBy: admin.user.id,
        });
      }
    }

    const triggerPayload = buildN8nTriggerPayload({
      client_id: store.id,
      store_id: store.id,
      webhook_config_id: targetWebhook.id,
      trigger_type: "manual_switch",
      subscription_id: activeSubscription.id,
      idempotency_key: idempotencyKey,
      triggered_at: nowIso,
      store_category: effectiveCategory,
      store_currency: store.store_currency,
      product_id: effectiveProductId,
      user_id: store.user_id,
      plan: activeSubscription.plan,
      source: "admin_manual_switch",
    });

    const schedulerJobInsert = await insertSchedulerJobWithFallback({
      subscriptionId: activeSubscription.id,
      userId: store.user_id,
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      plan: activeSubscription.plan,
      idempotencyKey,
      runAt: nowIso,
      requestPayload: triggerPayload,
    });

    if (schedulerJobInsert.error) {
      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: schedulerJobInsert.error,
          })
          .eq("id", transitionId);
      }

      if (schedulerJobInsert.error.toLowerCase().includes("zaten işlendi")) {
        return NextResponse.json(
          {
            code: "MANUAL_SWITCH_DUPLICATE",
            message: schedulerJobInsert.error,
            error: schedulerJobInsert.error,
            idempotencyKey,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: schedulerJobInsert.error }, { status: 500 });
    }

    const schedulerJobId = schedulerJobInsert.id;
    if (schedulerJobId) {
      await updateSchedulerJobWithFallback(schedulerJobId, {
        status: "processing",
        responseStatus: null,
        responsePayload: null,
        errorMessage: null,
      });
    }

    try {
      const dispatchResult = await dispatchN8nTrigger({
        url: targetWebhook.target_url,
        method: targetWebhook.method === "GET" ? "GET" : "POST",
        headers: targetWebhook.headers ?? {},
        payload: triggerPayload,
        idempotencyKey,
        triggeredAt: nowIso,
      });

      if (schedulerJobId) {
        await updateSchedulerJobWithFallback(schedulerJobId, {
          status: dispatchResult.ok ? "success" : "failed",
          responseStatus: dispatchResult.status,
          responsePayload: dispatchResult.body,
        });
      }

      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: dispatchResult.ok ? "success" : "failed",
            trigger_response_status: dispatchResult.status,
            trigger_response_body: dispatchResult.body,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({
        success: dispatchResult.ok,
        idempotencyKey,
        storeId: store.id,
        cronSync,
        directCronVerification,
        warning: cronWarning,
        transitionId: transitionId ?? null,
        schedulerJobId,
        monthIndex,
        targetWebhook: {
          id: targetWebhook.id,
          name: targetWebhook.name,
        },
        dispatch: {
          status: dispatchResult.status,
          body: dispatchResult.body,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Manual switch dispatch failed";

      if (schedulerJobId) {
        await updateSchedulerJobWithFallback(schedulerJobId, {
          status: "failed",
          errorMessage: message,
        });
      }

      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: message,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual switch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
