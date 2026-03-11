import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { serverEnv } from "@/lib/env/server";
import { getPlanCentsByInterval, getStripeClientForMode } from "@/lib/stripe/client";
import { syncOneTimeCheckoutPayment } from "@/lib/stripe/checkout-payment-sync";
import { buildN8nTriggerPayload, dispatchN8nTrigger } from "@/lib/n8n/client";
import { qualifyReferralConversion } from "@/lib/referral/qualify";
import { createActivationIdempotencyKey } from "@/lib/scheduler/idempotency";
import { findFirstProfileUserIdByEmail, syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

export const runtime = "nodejs";

const getStripe = () => getStripeClientForMode();
const ENABLE_STRIPE_ACTIVATION_AUTOMATION_DISPATCH = true;

const toIsoDate = (value: number | null | undefined) => {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const resolveSubscriptionPeriodEnd = (subscription: Stripe.Subscription) => {
  return subscription.items.data[0]?.current_period_end ?? null;
};

const resolveCustomerEmail = async (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
) => {
  if (!customer) {
    return null;
  }

  if (typeof customer === "object") {
    if ("deleted" in customer && customer.deleted) {
      return null;
    }

    return customer.email ?? null;
  }

  try {
    const fetched = await getStripe().customers.retrieve(customer);
    if ("deleted" in fetched && fetched.deleted) {
      return null;
    }

    return fetched.email ?? null;
  } catch {
    return null;
  }
};

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
};

const isMissingColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columnName: string
) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingOnConflictConstraintError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes("no unique or exclusion constraint matching");
};

const throwSupabaseError = (context: string, error: { message?: string } | null | undefined) => {
  if (!error) {
    return;
  }

  throw new Error(`${context}: ${error.message ?? "Unknown database error"}`);
};

const isMissingAnyColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columns: string[]
) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const isUniqueViolation = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "23505" || message.includes("duplicate");
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
    return "TRY" as const;
  }

  if (normalized === "USD") {
    return "USD" as const;
  }

  return null;
};

const normalizeForMatch = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const buildCategoryNeedles = (category: string | null | undefined) => {
  const normalized = normalizeForMatch(category);
  if (!normalized) {
    return [];
  }

  const parts = Array.from(
    new Set(
      normalized
        .split(/[/|>,;-]+/g)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3)
    )
  );

  return Array.from(new Set([normalized, ...parts]));
};

const loadStoreWebhookMappingFromLogs = async (storeId: string) => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return null;
  }

  for (const row of (data ?? []) as Array<{ request_body: unknown; request_url?: string | null }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;
    if (!body) continue;

    const sourceUrl = typeof row.request_url === "string" ? row.request_url : null;
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
    const isManualBinding = sourceUrl === "store-webhook-mapping" || (idempotencyKey?.startsWith("manual_switch:") ?? false);
    const isActivationBinding =
      sourceUrl === "store-webhook-mapping-activation" || (idempotencyKey?.startsWith("activation:") ?? false);
    if (!isManualBinding && !isActivationBinding) continue;

    if (body.store_id !== storeId) continue;
    const webhookConfigId = typeof body.webhook_config_id === "string" ? body.webhook_config_id : null;
    if (webhookConfigId) return webhookConfigId;
  }

  return null;
};

const loadStoreWebhookConfigId = async (storeId: string) => {
  const withColumn = await supabaseAdmin
    .from("stores")
    .select("id, active_webhook_config_id")
    .eq("id", storeId)
    .maybeSingle<{ id: string; active_webhook_config_id: string | null }>();

  if (!withColumn.error) {
    return withColumn.data?.active_webhook_config_id ?? null;
  }

  if (!isMissingColumnError(withColumn.error, "active_webhook_config_id")) {
    throw new Error(withColumn.error.message);
  }

  return loadStoreWebhookMappingFromLogs(storeId);
};

const loadAutomationWebhookConfig = async (id: string) => {
  const withScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled, scope")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
      scope?: string | null;
    }>();

  if (!withScope.error) {
    return withScope.data;
  }

  if (!isMissingColumnError(withScope.error, "scope")) {
    throw new Error(withScope.error.message);
  }

  const fallback = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
    }>();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  if (!fallback.data) {
    return null;
  }

  return { ...fallback.data, scope: "automation" };
};

const loadStoreActivationBinding = async (storeId: string) => {
  const candidates = [
    {
      select: "id,product_id,sub_category_id,subcategory_id,active_webhook_config_id,store_currency,currency,category",
      hasProduct: true,
      hasSubCategory: true,
      hasActiveWebhook: true,
      hasStoreCurrency: true,
      hasCurrency: true,
      hasCategory: true,
    },
    {
      select: "id,product_id,sub_category_id,subcategory_id,active_webhook_config_id,store_currency,category",
      hasProduct: true,
      hasSubCategory: true,
      hasActiveWebhook: true,
      hasStoreCurrency: true,
      hasCurrency: false,
      hasCategory: true,
    },
    {
      select: "id,product_id,sub_category_id,subcategory_id,active_webhook_config_id,currency,category",
      hasProduct: true,
      hasSubCategory: true,
      hasActiveWebhook: true,
      hasStoreCurrency: false,
      hasCurrency: true,
      hasCategory: true,
    },
    {
      select: "id,product_id,sub_category_id,subcategory_id,active_webhook_config_id,category",
      hasProduct: true,
      hasSubCategory: true,
      hasActiveWebhook: true,
      hasStoreCurrency: false,
      hasCurrency: false,
      hasCategory: true,
    },
    {
      select: "id,product_id,active_webhook_config_id,store_currency,currency,category",
      hasProduct: true,
      hasSubCategory: false,
      hasActiveWebhook: true,
      hasStoreCurrency: true,
      hasCurrency: true,
      hasCategory: true,
    },
    {
      select: "id,product_id,active_webhook_config_id,category",
      hasProduct: true,
      hasSubCategory: false,
      hasActiveWebhook: true,
      hasStoreCurrency: false,
      hasCurrency: false,
      hasCategory: true,
    },
    {
      select: "id,active_webhook_config_id,store_currency,currency,category",
      hasProduct: false,
      hasSubCategory: false,
      hasActiveWebhook: true,
      hasStoreCurrency: true,
      hasCurrency: true,
      hasCategory: true,
    },
    {
      select: "id,active_webhook_config_id,category",
      hasProduct: false,
      hasSubCategory: false,
      hasActiveWebhook: true,
      hasStoreCurrency: false,
      hasCurrency: false,
      hasCategory: true,
    },
    {
      select: "id,category",
      hasProduct: false,
      hasSubCategory: false,
      hasActiveWebhook: false,
      hasStoreCurrency: false,
      hasCurrency: false,
      hasCategory: true,
    },
  ] as const;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("id", storeId)
      .maybeSingle<{
        id: string;
        product_id?: string | null;
        sub_category_id?: string | null;
        subcategory_id?: string | null;
        active_webhook_config_id?: string | null;
        store_currency?: string | null;
        currency?: string | null;
        category?: string | null;
      }>();

    if (!query.error) {
      const productId =
        (candidate.hasProduct ? query.data?.product_id ?? null : null) ??
        (candidate.hasSubCategory ? query.data?.sub_category_id ?? query.data?.subcategory_id ?? null : null) ??
        null;
      const storeCurrency = normalizeStoreCurrency(
        candidate.hasStoreCurrency
          ? query.data?.store_currency ?? null
          : candidate.hasCurrency
            ? query.data?.currency ?? null
            : null
      );

      return {
        productId,
        activeWebhookConfigId: candidate.hasActiveWebhook ? query.data?.active_webhook_config_id ?? null : null,
        storeCurrency,
        category: candidate.hasCategory ? query.data?.category ?? null : null,
      };
    }

    if (
      !isMissingAnyColumnError(query.error, [
        "product_id",
        "sub_category_id",
        "subcategory_id",
        "active_webhook_config_id",
        "store_currency",
        "currency",
        "category",
      ])
    ) {
      throw new Error(query.error.message);
    }
  }

  return {
    productId: null,
    activeWebhookConfigId: null,
    storeCurrency: null,
    category: null,
  };
};

const resolveProductIdByStoreCategory = async (category: string) => {
  const needles = buildCategoryNeedles(category);
  if (!needles.length) {
    return null;
  }

  const candidates = [
    "id,title_tr,title_en,title",
    "id,title_tr,title",
    "id,title_tr",
    "id,title",
  ] as const;

  let rows: Array<{ id: string; title_tr?: string | null; title_en?: string | null; title?: string | null }> = [];

  for (const select of candidates) {
    const query = await supabaseAdmin.from("products").select(select).limit(5000);
    if (!query.error) {
      rows = (query.data ?? []) as unknown as Array<{
        id: string;
        title_tr?: string | null;
        title_en?: string | null;
        title?: string | null;
      }>;
      break;
    }

    if (!isMissingAnyColumnError(query.error, ["title_tr", "title_en", "title"])) {
      throw new Error(query.error.message);
    }
  }

  if (!rows.length) {
    return null;
  }

  let bestProductId: string | null = null;
  let bestScore = -1;

  for (const row of rows) {
    const titles = [row.title_tr ?? null, row.title_en ?? null, row.title ?? null]
      .map((item) => normalizeForMatch(item))
      .filter(Boolean);

    if (!titles.length) {
      continue;
    }

    let score = 0;
    for (const title of titles) {
      if (needles.includes(title)) {
        score = Math.max(score, 100);
        continue;
      }

      for (const needle of needles) {
        if (needle === title) {
          score = Math.max(score, 100);
        } else if (needle.includes(title) || title.includes(needle)) {
          score = Math.max(score, 75);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestProductId = row.id;
    }
  }

  return bestScore >= 75 ? bestProductId : null;
};

const pickWebhookIdByCurrencyPreference = (
  rows: Array<{ id: string; currency?: string | null }>,
  preferredCurrency: "USD" | "TRY" | null
) => {
  if (!rows.length) {
    return null;
  }

  const normalized = rows.map((row) => ({
    id: row.id,
    currency: normalizeStoreCurrency(row.currency ?? null),
  }));

  if (preferredCurrency) {
    const exact = normalized.find((row) => row.currency === preferredCurrency);
    if (exact) {
      return exact.id;
    }
  }

  const generic = normalized.find((row) => row.currency === null);
  if (generic) {
    return generic.id;
  }

  return normalized[0]?.id ?? null;
};

const resolveWebhookByProduct = async (productId: string, preferredCurrency: "USD" | "TRY" | null) => {
  const withProductScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id,target_url,method,headers,enabled,scope,product_id,currency")
    .eq("enabled", true)
    .eq("scope", "automation")
    .eq("product_id", productId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (!withProductScope.error) {
    const rows = (withProductScope.data ?? []) as Array<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
      scope?: string | null;
      product_id?: string | null;
      currency?: string | null;
    }>;

    return pickWebhookIdByCurrencyPreference(rows, preferredCurrency);
  }

  if (!isMissingAnyColumnError(withProductScope.error, ["scope", "product_id", "currency"])) {
    throw new Error(withProductScope.error.message);
  }

  if (!isMissingColumnError(withProductScope.error, "scope") && !isMissingColumnError(withProductScope.error, "product_id")) {
    const noCurrency = await supabaseAdmin
      .from("webhook_configs")
      .select("id,target_url,method,headers,enabled,scope,product_id")
      .eq("enabled", true)
      .eq("scope", "automation")
      .eq("product_id", productId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
      }>();

    if (!noCurrency.error) {
      return noCurrency.data?.id ?? null;
    }

    if (!isMissingAnyColumnError(noCurrency.error, ["scope", "product_id"])) {
      throw new Error(noCurrency.error.message);
    }
  }

  const fallbackRows = await supabaseAdmin
    .from("webhook_configs")
    .select("id,target_url,method,headers,enabled,scope,currency")
    .eq("enabled", true)
    .order("updated_at", { ascending: false })
    .limit(5000);

  let rows = (fallbackRows.data ?? []) as Array<{
    id: string;
    scope?: string | null;
    target_url?: string | null;
    currency?: string | null;
  }>;

  if (fallbackRows.error) {
    if (!isMissingColumnError(fallbackRows.error, "currency")) {
      throw new Error(fallbackRows.error.message);
    }

    const noCurrencyFallbackRows = await supabaseAdmin
      .from("webhook_configs")
      .select("id,target_url,method,headers,enabled,scope")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (noCurrencyFallbackRows.error) {
      throw new Error(noCurrencyFallbackRows.error.message);
    }

    rows = (noCurrencyFallbackRows.data ?? []) as Array<{
      id: string;
      scope?: string | null;
      target_url?: string | null;
    }>;
  }

  const activeAutomationConfigIds = rows
    .filter((row) => Boolean(row.target_url) && (row.scope ?? "automation") !== "generic")
    .map((row) => row.id);

  if (!activeAutomationConfigIds.length) {
    return null;
  }

  const productMap = await loadWebhookConfigProductMap(activeAutomationConfigIds);
  const matchingRows = rows.filter(
    (row) =>
      activeAutomationConfigIds.includes(row.id) &&
      productMap.get(row.id) === productId
  );

  if (!matchingRows.length) {
    return null;
  }

  return pickWebhookIdByCurrencyPreference(
    matchingRows.map((row) => ({ id: row.id, currency: row.currency ?? null })),
    preferredCurrency
  );
};

const resolveSingletonAutomationWebhookByCurrency = async (preferredCurrency: "USD" | "TRY" | null) => {
  const withCurrency = await supabaseAdmin
    .from("webhook_configs")
    .select("id,target_url,enabled,scope,currency")
    .eq("enabled", true)
    .order("updated_at", { ascending: false })
    .limit(5000);

  let rows = (withCurrency.data ?? []) as Array<{
    id: string;
    target_url?: string | null;
    enabled?: boolean | null;
    scope?: string | null;
    currency?: string | null;
  }>;

  if (withCurrency.error) {
    if (!isMissingColumnError(withCurrency.error, "currency")) {
      throw new Error(withCurrency.error.message);
    }

    const withoutCurrency = await supabaseAdmin
      .from("webhook_configs")
      .select("id,target_url,enabled,scope")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (withoutCurrency.error) {
      throw new Error(withoutCurrency.error.message);
    }

    rows = (withoutCurrency.data ?? []) as Array<{
      id: string;
      target_url?: string | null;
      enabled?: boolean | null;
      scope?: string | null;
    }>;
  }

  const activeRows = rows.filter((row) => Boolean(row.target_url) && (row.scope ?? "automation") !== "generic");
  if (!activeRows.length) {
    return null;
  }

  if (!preferredCurrency) {
    return activeRows.length === 1 ? activeRows[0].id : null;
  }

  const exact = activeRows.filter((row) => normalizeStoreCurrency(row.currency ?? null) === preferredCurrency);
  if (exact.length === 1) {
    return exact[0].id;
  }

  if (exact.length > 1) {
    return null;
  }

  const generic = activeRows.filter((row) => normalizeStoreCurrency(row.currency ?? null) === null);
  return generic.length === 1 ? generic[0].id : null;
};

const persistActivationStoreWebhookMapping = async (args: {
  storeId: string;
  webhookConfigId: string;
  idempotencyKey: string;
  createdBy: string | null;
}) => {
  const payload = {
    store_id: args.storeId,
    webhook_config_id: args.webhookConfigId,
    idempotency_key: args.idempotencyKey,
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      request_url: "store-webhook-mapping-activation",
      request_method: "STORE_WEBHOOK_MAP",
      request_headers: {},
      request_body: payload,
      response_status: 200,
      response_body: "mapping_saved",
      duration_ms: 0,
      created_by: args.createdBy,
    },
    {
      request_url: "store-webhook-mapping-activation",
      request_method: "STORE_WEBHOOK_MAP",
      request_body: payload,
    },
  ];

  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(candidate);
    if (!error) return;
    if (!isMissingAnyColumnError(error, ["request_headers", "response_status", "response_body", "duration_ms", "created_by"])) {
      throw new Error(error.message);
    }
  }
};

const updateStoreActivationBinding = async (args: {
  storeId: string;
  webhookConfigId: string;
  productId: string | null;
  userId: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      active_webhook_config_id: args.webhookConfigId,
      product_id: args.productId,
      automation_updated_at: nowIso,
      automation_updated_by: args.userId,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      product_id: args.productId,
      automation_updated_at: nowIso,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: nowIso,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);
    if (!attempt.error) return;

    if (!isMissingAnyColumnError(attempt.error, ["active_webhook_config_id", "product_id", "automation_updated_at", "automation_updated_by"])) {
      throw new Error(attempt.error.message);
    }
  }
};

const ensureActivationWebhookBinding = async (args: {
  storeId: string;
  userId: string | null;
  idempotencyKey: string;
}) => {
  const storeBinding = await loadStoreActivationBinding(args.storeId);
  const explicitWebhookId = storeBinding.activeWebhookConfigId;

  if (explicitWebhookId) {
    const explicitWebhook = await loadAutomationWebhookConfig(explicitWebhookId);
    if (explicitWebhook && explicitWebhook.enabled && explicitWebhook.scope !== "generic") {
      return explicitWebhookId;
    }
  }

  const effectiveProductId =
    storeBinding.productId ??
    (storeBinding.category ? await resolveProductIdByStoreCategory(storeBinding.category) : null);

  if (!effectiveProductId) {
    const singletonWebhookId = await resolveSingletonAutomationWebhookByCurrency(storeBinding.storeCurrency);
    if (singletonWebhookId) {
      await updateStoreActivationBinding({
        storeId: args.storeId,
        webhookConfigId: singletonWebhookId,
        productId: null,
        userId: args.userId,
      });
      await persistActivationStoreWebhookMapping({
        storeId: args.storeId,
        webhookConfigId: singletonWebhookId,
        idempotencyKey: args.idempotencyKey,
        createdBy: args.userId,
      });
      return singletonWebhookId;
    }
    return loadStoreWebhookConfigId(args.storeId);
  }

  const webhookConfigId = await resolveWebhookByProduct(effectiveProductId, storeBinding.storeCurrency);
  if (!webhookConfigId) {
    const singletonWebhookId = await resolveSingletonAutomationWebhookByCurrency(storeBinding.storeCurrency);
    if (singletonWebhookId) {
      await updateStoreActivationBinding({
        storeId: args.storeId,
        webhookConfigId: singletonWebhookId,
        productId: effectiveProductId,
        userId: args.userId,
      });
      await persistActivationStoreWebhookMapping({
        storeId: args.storeId,
        webhookConfigId: singletonWebhookId,
        idempotencyKey: args.idempotencyKey,
        createdBy: args.userId,
      });
      return singletonWebhookId;
    }
    return loadStoreWebhookConfigId(args.storeId);
  }

  await updateStoreActivationBinding({
    storeId: args.storeId,
    webhookConfigId,
    productId: effectiveProductId,
    userId: args.userId,
  });

  await persistActivationStoreWebhookMapping({
    storeId: args.storeId,
    webhookConfigId,
    idempotencyKey: args.idempotencyKey,
    createdBy: args.userId,
  });

  return webhookConfigId;
};

const insertSchedulerActivationJobWithFallback = async (args: {
  subscriptionId: string;
  userId: string | null;
  storeId: string;
  plan: string;
  webhookConfigId: string | null;
  idempotencyKey: string;
  runAtIso: string;
  status: "processing" | "skipped";
  errorMessage?: string | null;
  requestPayload?: Record<string, unknown> | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      trigger_type: "activation",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      request_payload: args.requestPayload ?? { client_id: args.storeId },
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      trigger_type: "activation",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
  ];

  let lastError: { message?: string; code?: string } | null = null;

  for (const payload of payloads) {
    const insert = await supabaseAdmin
      .from("scheduler_jobs")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!insert.error) {
      return { id: insert.data?.id ?? null };
    }

    if (isUniqueViolation(insert.error)) {
      return { id: null, duplicated: true };
    }

    lastError = insert.error;

    if (
      !isMissingAnyColumnError(insert.error, [
        "store_id",
        "webhook_config_id",
        "trigger_type",
        "request_payload",
        "error_message",
      ])
    ) {
      throw new Error(insert.error.message);
    }
  }

  throw new Error(lastError?.message ?? "scheduler_jobs activation insert failed");
};

const updateSchedulerJobWithFallback = async (jobId: string, patch: {
  status: string;
  responseStatus?: number | null;
  responsePayload?: string | null;
  errorMessage?: string | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
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
    if (!attempt.error) return;

    if (!isMissingAnyColumnError(attempt.error, ["response_status", "response_payload", "error_message", "updated_at"])) {
      throw new Error(attempt.error.message);
    }
  }
};

const triggerActivationAutomation = async (args: {
  storeId: string;
  subscription: Stripe.Subscription;
  plan: string;
  userId: string | null;
}) => {
  const runAtIso = new Date().toISOString();
  const currentPeriodEndIso = toIsoDate(resolveSubscriptionPeriodEnd(args.subscription));
  const idempotencyKey = createActivationIdempotencyKey(
    args.subscription.id,
    args.storeId,
    currentPeriodEndIso
  );

  const activeWebhookConfigId = await ensureActivationWebhookBinding({
    storeId: args.storeId,
    userId: args.userId,
    idempotencyKey,
  });
  const storeBinding = await loadStoreActivationBinding(args.storeId);
  const triggerPayload = buildN8nTriggerPayload({
    client_id: args.storeId,
    store_id: args.storeId,
    webhook_config_id: activeWebhookConfigId,
    trigger_type: "activation",
    subscription_id: args.subscription.id,
    idempotency_key: idempotencyKey,
    triggered_at: runAtIso,
    store_category: storeBinding.category ?? null,
    store_currency: storeBinding.storeCurrency ?? null,
    product_id: storeBinding.productId ?? null,
    user_id: args.userId,
    plan: args.plan,
    source: "stripe_activation",
  });

  if (!activeWebhookConfigId) {
    await insertSchedulerActivationJobWithFallback({
      subscriptionId: args.subscription.id,
      userId: args.userId,
      storeId: args.storeId,
      plan: args.plan,
      webhookConfigId: null,
      idempotencyKey,
      runAtIso,
      status: "skipped",
      errorMessage: "no_active_webhook_config",
      requestPayload: triggerPayload,
    });
    return;
  }

  const webhook = await loadAutomationWebhookConfig(activeWebhookConfigId);

  if (!webhook || !webhook.enabled || webhook.scope === "generic") {
    await insertSchedulerActivationJobWithFallback({
      subscriptionId: args.subscription.id,
      userId: args.userId,
      storeId: args.storeId,
      plan: args.plan,
      webhookConfigId: activeWebhookConfigId,
      idempotencyKey,
      runAtIso,
      status: "skipped",
      errorMessage: "inactive_or_invalid_webhook_config",
      requestPayload: triggerPayload,
    });
    return;
  }

  const createdJob = await insertSchedulerActivationJobWithFallback({
    subscriptionId: args.subscription.id,
    userId: args.userId,
    storeId: args.storeId,
    plan: args.plan,
    webhookConfigId: activeWebhookConfigId,
    idempotencyKey,
    runAtIso,
    status: "processing",
    requestPayload: triggerPayload,
  });

  if (createdJob.duplicated) {
    return;
  }

  if (!createdJob.id) {
    return;
  }

  try {
    const dispatch = await dispatchN8nTrigger({
      url: webhook.target_url,
      method: webhook.method === "GET" ? "GET" : "POST",
      headers: webhook.headers ?? {},
      payload: triggerPayload,
      idempotencyKey,
      triggeredAt: runAtIso,
    });

    await updateSchedulerJobWithFallback(createdJob.id, {
      status: dispatch.ok ? "success" : "failed",
      responseStatus: dispatch.status,
      responsePayload: dispatch.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "activation dispatch failed";
    await updateSchedulerJobWithFallback(createdJob.id, {
      status: "failed",
      errorMessage: message,
    });
  }
};

const persistStripeEvent = async (event: Stripe.Event) => {
  const basePayload = {
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
    processed_at: new Date().toISOString(),
  };
  const withMode = await supabaseAdmin
    .from("stripe_event_logs")
    .insert({
      ...basePayload,
      stripe_mode: event.livemode ? "live" : "test",
    })
    .select("id")
    .maybeSingle();

  if (!withMode.error) {
    return { duplicated: false, id: withMode.data?.id };
  }

  if (withMode.error.message.toLowerCase().includes("duplicate") || withMode.error.code === "23505") {
    return { duplicated: true };
  }

  if (isMissingRelationError(withMode.error)) {
    throw new Error(
      "Missing table public.stripe_event_logs. Apply Supabase schema/migrations before processing Stripe webhooks."
    );
  }

  if (!isMissingColumnError(withMode.error, "stripe_mode")) {
    throw new Error(`Failed to persist Stripe event log: ${withMode.error.message}`);
  }

  const fallback = await supabaseAdmin
    .from("stripe_event_logs")
    .insert(basePayload)
    .select("id")
    .maybeSingle();

  if (fallback.error) {
    if (fallback.error.message.toLowerCase().includes("duplicate") || fallback.error.code === "23505") {
      return { duplicated: true };
    }

    if (isMissingRelationError(fallback.error)) {
      throw new Error(
        "Missing table public.stripe_event_logs. Apply Supabase schema/migrations before processing Stripe webhooks."
      );
    }

    throw new Error(`Failed to persist Stripe event log: ${fallback.error.message}`);
  }

  return { duplicated: false, id: fallback.data?.id };
};

const upsertSubscriptionFromStripe = async (
  subscription: Stripe.Subscription,
  metadata?: Stripe.Metadata | null,
  customerId?: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  subscriberEmail?: string | null,
  options?: {
    triggerActivationDispatch?: boolean;
  }
) => {
  const plan = (metadata?.plan as string | undefined) ?? "standard";
  const billingInterval = (metadata?.billingInterval as string | undefined) === "year" ? "year" : "month";
  const metadataUserId = metadata?.userId as string | undefined;
  const emailUserId = !metadataUserId && subscriberEmail ? await findFirstProfileUserIdByEmail(subscriberEmail) : null;
  const userId = metadataUserId ?? emailUserId ?? null;
  const metadataStoreId = typeof metadata?.storeId === "string" ? metadata.storeId.trim() : null;
  const metadataShopId = typeof metadata?.shopId === "string" ? metadata.shopId.trim() : null;
  const shopId = metadataShopId || metadataStoreId || undefined;
  const storeId = isUuid(metadataStoreId) ? metadataStoreId : isUuid(metadataShopId) ? metadataShopId : null;
  const stripeUnitAmount = subscription.items.data[0]?.price?.unit_amount ?? null;
  const stripeCustomerId = typeof customerId === "string"
    ? customerId
    : typeof subscription.customer === "string"
      ? subscription.customer
      : null;

  const payloadBase = {
    user_id: userId,
    shop_id: shopId ?? null,
    store_id: storeId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_end: toIsoDate(resolveSubscriptionPeriodEnd(subscription)),
    updated_at: new Date().toISOString(),
  };
  const payloadWithMode = {
    ...payloadBase,
    stripe_mode: subscription.livemode ? "live" : "test",
  };
  let payload: Record<string, unknown> = payloadWithMode;

  let upsertResult = await supabaseAdmin
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (upsertResult.error && isMissingColumnError(upsertResult.error, "stripe_mode")) {
    payload = payloadBase;
    upsertResult = await supabaseAdmin
      .from("subscriptions")
      .upsert(payload, { onConflict: "stripe_subscription_id" });
  }

  if (upsertResult.error) {
    if (!isMissingOnConflictConstraintError(upsertResult.error)) {
      throwSupabaseError("Failed to upsert subscription", upsertResult.error);
    }

    const existing = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle<{ id?: string }>();

    throwSupabaseError("Failed to read existing subscription fallback", existing.error);

    if (existing.data?.id) {
      const updated = await supabaseAdmin
        .from("subscriptions")
        .update(payload)
        .eq("id", existing.data.id);

      throwSupabaseError("Failed to update subscription fallback", updated.error);
    } else {
      const inserted = await supabaseAdmin
        .from("subscriptions")
        .insert(payload);

      throwSupabaseError("Failed to insert subscription fallback", inserted.error);
    }
  }

  if (storeId) {
    const fallbackPlan = (plan === "pro" || plan === "turbo" ? plan : "standard") as "standard" | "pro" | "turbo";
    const cents = stripeUnitAmount ?? getPlanCentsByInterval(fallbackPlan, billingInterval);

    const storeUpdate = await supabaseAdmin
      .from("stores")
      .update({
        status: subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status,
        price_cents: cents,
      })
      .eq("id", storeId);

    throwSupabaseError("Failed to update store after subscription sync", storeUpdate.error);

    if (
      ENABLE_STRIPE_ACTIVATION_AUTOMATION_DISPATCH &&
      options?.triggerActivationDispatch === true &&
      (subscription.status === "active" || subscription.status === "trialing")
    ) {
      try {
        await triggerActivationAutomation({
          storeId,
          subscription,
          plan: fallbackPlan,
          userId,
        });
      } catch {
        // Activation dispatch should not block authoritative subscription sync.
      }
    }
  }

  await syncProfileSubscriptionState({
    userId,
    email: subscriberEmail ?? null,
    status: subscription.status,
    plan,
    stripeCustomerId,
  });

  // Qualify referral conversion only when the referred user activates their first
  // store and that store is on a Pro or Turbo plan.
  if (
    userId &&
    storeId &&
    options?.triggerActivationDispatch === true &&
    (subscription.status === "active" || subscription.status === "trialing")
  ) {
    try {
      await qualifyReferralConversion({
        referredUserId: userId,
        storeId,
        plan,
      });
    } catch {
      // Referral qualification should never block subscription sync
    }
  }
};

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(payload, signature, serverEnv.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const persisted = await persistStripeEvent(event);
    if (persisted.duplicated) {
      return NextResponse.json({ received: true, duplicated: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event log persist failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    let shouldSyncCronLifecycle = false;
    let forceCronSync = false;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode === "subscription" && typeof session.subscription === "string") {
          shouldSyncCronLifecycle = true;
          forceCronSync = true;
          const subscription = await getStripe().subscriptions.retrieve(session.subscription);
          const subscriberEmail =
            session.customer_details?.email ??
            session.customer_email ??
            (await resolveCustomerEmail(session.customer));
          const mergedMetadata = {
            ...(subscription.metadata ?? {}),
            ...(session.metadata ?? {}),
          };
          await upsertSubscriptionFromStripe(subscription, mergedMetadata, session.customer, subscriberEmail, {
            triggerActivationDispatch: true,
          });
        }

        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session);
        }

        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session, { forcedStatus: "paid" });
        }
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session, { forcedStatus: "failed" });
        }
        break;
      }
      case "customer.subscription.created": {
        shouldSyncCronLifecycle = true;
        forceCronSync = true;
        const subscription = event.data.object as Stripe.Subscription;
        const subscriberEmail = await resolveCustomerEmail(subscription.customer);
        await upsertSubscriptionFromStripe(subscription, subscription.metadata, subscription.customer, subscriberEmail, {
          triggerActivationDispatch: true,
        });
        break;
      }
      case "customer.subscription.updated": {
        shouldSyncCronLifecycle = true;
        const subscription = event.data.object as Stripe.Subscription;
        const subscriberEmail = await resolveCustomerEmail(subscription.customer);
        await upsertSubscriptionFromStripe(subscription, subscription.metadata, subscription.customer, subscriberEmail, {
          triggerActivationDispatch: false,
        });
        break;
      }
      case "customer.subscription.deleted": {
        shouldSyncCronLifecycle = true;
        forceCronSync = true;
        const subscription = event.data.object as Stripe.Subscription;
        const existingSubscription = await supabaseAdmin
          .from("subscriptions")
          .select("user_id, plan, stripe_customer_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle<{ user_id?: string | null; plan?: string | null; stripe_customer_id?: string | null }>();

        throwSupabaseError("Failed to read subscription for profile sync", existingSubscription.error);

        const deletedUpdate = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "canceled",
            current_period_end: toIsoDate(resolveSubscriptionPeriodEnd(subscription)),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        throwSupabaseError("Failed to mark subscription as canceled", deletedUpdate.error);

        const customerEmail = await resolveCustomerEmail(subscription.customer);
        const metadataUserId = subscription.metadata?.userId as string | undefined;
        const metadataPlan = subscription.metadata?.plan as string | undefined;
        const stripeCustomerId =
          existingSubscription.data?.stripe_customer_id ??
          (typeof subscription.customer === "string" ? subscription.customer : null);

        await syncProfileSubscriptionState({
          userId: existingSubscription.data?.user_id ?? metadataUserId ?? null,
          email: customerEmail,
          status: "canceled",
          plan: existingSubscription.data?.plan ?? metadataPlan ?? null,
          stripeCustomerId,
        });
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription =
          typeof invoice.parent?.subscription_details?.subscription === "string"
            ? invoice.parent.subscription_details.subscription
            : null;

        const invoicePaymentInsert = await supabaseAdmin.from("payments").insert({
          user_id: invoice.metadata?.userId ?? null,
          shop_id: invoice.metadata?.shopId ?? null,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: invoiceSubscription,
          amount_cents: invoice.amount_paid || invoice.amount_due || 0,
          currency: invoice.currency ?? "usd",
          status: event.type === "invoice.payment_succeeded" ? "paid" : "failed",
        });

        throwSupabaseError("Failed to persist invoice payment", invoicePaymentInsert.error);

        const invoiceEmail = invoice.customer_email ?? (await resolveCustomerEmail(invoice.customer));
        const invoicePlan = (invoice.metadata?.plan as string | undefined) ?? null;
        const invoiceStatus = event.type === "invoice.payment_succeeded" ? "active" : "past_due";
        const invoiceCustomerId = typeof invoice.customer === "string" ? invoice.customer : null;

        await syncProfileSubscriptionState({
          userId: (invoice.metadata?.userId as string | undefined) ?? null,
          email: invoiceEmail,
          status: invoiceStatus,
          plan: invoicePlan,
          stripeCustomerId: invoiceCustomerId,
        });
        break;
      }
      default:
        break;
    }

    let cronSyncError: string | null = null;
    if (shouldSyncCronLifecycle) {
      try {
        await syncSchedulerCronJobLifecycle(forceCronSync ? { force: true } : undefined);
      } catch (error) {
        cronSyncError = error instanceof Error ? error.message : "Cron sync failed";
      }
    }

    return NextResponse.json({ received: true, cronSyncError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
