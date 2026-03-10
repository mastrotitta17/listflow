import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import type Stripe from "stripe";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { getPlanCentsByInterval, getStripeClientForMode, resolveStripeModeForRequest } from "@/lib/stripe/client";
import { syncOneTimeCheckoutPayment } from "@/lib/stripe/checkout-payment-sync";
import { findFirstProfileUserIdByEmail, syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

export const runtime = "nodejs";

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
  stripe: Stripe,
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
    const fetched = await stripe.customers.retrieve(customer);
    if ("deleted" in fetched && fetched.deleted) {
      return null;
    }

    return fetched.email ?? null;
  } catch {
    return null;
  }
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

const isMissingAnyColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columns: string[]
) => {
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

const metadataValue = (metadata: Stripe.Metadata | null | undefined, key: string) => {
  const raw = metadata?.[key];
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed || null;
};

const resolveStoreIdFromMetadata = async (args: {
  metadata: Stripe.Metadata | null | undefined;
  userId: string | null;
}) => {
  const candidates = Array.from(
    new Set([metadataValue(args.metadata, "storeId"), metadataValue(args.metadata, "shopId")].filter(Boolean) as string[])
  );

  for (const candidate of candidates) {
    if (isUuid(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const byId = await supabaseAdmin.from("stores").select("id").eq("id", candidate).maybeSingle<{ id: string }>();
    if (!byId.error && byId.data?.id) {
      return byId.data.id;
    }
  }

  if (!args.userId || !candidates.length) {
    return null;
  }

  const byName = await supabaseAdmin
    .from("stores")
    .select("id,store_name")
    .eq("user_id", args.userId)
    .limit(500)
    .returns<Array<{ id: string; store_name?: string | null }>>();

  if (byName.error) {
    if (!isMissingColumnError(byName.error, "store_name")) {
      throw new Error(byName.error.message);
    }
    return null;
  }

  const needleSet = new Set(candidates.map((item) => normalizeForMatch(item)).filter(Boolean));
  const matched = (byName.data ?? []).filter((row) => {
    const normalizedName = normalizeForMatch(row.store_name ?? null);
    return normalizedName ? needleSet.has(normalizedName) : false;
  });

  if (matched.length === 1) {
    return matched[0].id;
  }

  return null;
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
    const isAutoBindMapping =
      sourceUrl === "store-webhook-mapping-auto-bind" || (idempotencyKey?.startsWith("auto_bind:") ?? false);
    if (!isManualBinding && !isActivationBinding && !isAutoBindMapping) continue;

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
      .maybeSingle<{ id: string }>();

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

const recoverSubscriptionRow = async (
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
  subscriberEmail: string | null
) => {
  const mergedMetadata = {
    ...(subscription.metadata ?? {}),
    ...(session.metadata ?? {}),
  };
  const plan = (mergedMetadata.plan as string | undefined) ?? "standard";
  const billingInterval = (mergedMetadata.billingInterval as string | undefined) === "year" ? "year" : "month";
  const metadataUserId = (mergedMetadata.userId as string | undefined) ?? null;
  const emailUserId = !metadataUserId && subscriberEmail ? await findFirstProfileUserIdByEmail(subscriberEmail) : null;
  const userId = metadataUserId ?? emailUserId ?? null;
  const metadataStoreId = metadataValue(mergedMetadata, "storeId");
  const metadataShopId = metadataValue(mergedMetadata, "shopId");
  const shopId = metadataShopId ?? metadataStoreId;
  const storeId = await resolveStoreIdFromMetadata({
    metadata: mergedMetadata,
    userId,
  });
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : typeof subscription.customer === "string"
        ? subscription.customer
        : null;
  const stripeUnitAmount = subscription.items.data[0]?.price?.unit_amount ?? null;

  const payloadBase = {
    user_id: userId,
    shop_id: shopId,
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
      throwSupabaseError("Failed to recover subscription row", upsertResult.error);
    }

    const existing = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle<{ id?: string }>();

    throwSupabaseError("Failed to read subscription fallback", existing.error);

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

    throwSupabaseError("Failed to update store from verify-session recovery", storeUpdate.error);

    if (subscription.status === "active" || subscription.status === "trialing") {
      const idempotencyKey = `activation_verify:${subscription.id}:${storeId}:${Math.floor(Date.now() / 60_000)}`;
      try {
        await ensureActivationWebhookBinding({
          storeId,
          userId,
          idempotencyKey,
        });
      } catch {
        // Non-blocking fallback path.
      }

      try {
        await syncSchedulerCronJobLifecycle({ force: true });
      } catch {
        // Non-blocking fallback path.
      }
    }
  }

  await syncProfileSubscriptionState({
    userId,
    email: subscriberEmail,
    status: subscription.status,
    plan,
    stripeCustomerId,
  });
};

export async function POST(request: NextRequest) {
  try {
    const stripeMode = resolveStripeModeForRequest(request);
    const stripe = getStripeClientForMode(stripeMode);
    const body = (await request.json()) as { sessionId?: string };

    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const user = accessToken ? await getUserFromAccessToken(accessToken) : null;

    const session = await stripe.checkout.sessions.retrieve(body.sessionId, {
      expand: ["subscription"],
    });

    const metadataUserId = session.metadata?.userId;

    if (user && metadataUserId && metadataUserId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const subscriptionFromStripe =
      typeof session.subscription === "object" && session.subscription
        ? session.subscription
        : null;

    let oneTimePaymentStatus: "paid" | "pending" | "failed" | null = null;

    if (session.mode === "payment") {
      const oneTimeSync = await syncOneTimeCheckoutPayment(session);
      oneTimePaymentStatus = oneTimeSync.paymentStatus;
    }

    const stripeStatus = subscriptionFromStripe?.status ?? null;

    if (subscriptionFromStripe) {
      const subscriberEmail =
        session.customer_details?.email ??
        session.customer_email ??
        (await resolveCustomerEmail(stripe, subscriptionFromStripe.customer));

      await recoverSubscriptionRow(session, subscriptionFromStripe, subscriberEmail);
    }

    let dbStatus: string | null = null;

    if (subscriptionFromStripe?.id) {
      const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .select("status")
        .eq("stripe_subscription_id", subscriptionFromStripe.id)
        .maybeSingle<{ status?: string | null }>();

      if (error) {
        throw new Error(`Failed to read recovered subscription row: ${error.message}`);
      }

      dbStatus = data?.status ?? null;
    }

    const isActive =
      session.mode === "payment"
        ? oneTimePaymentStatus === "paid" || session.payment_status === "paid"
        : stripeStatus === "active" ||
          stripeStatus === "trialing" ||
          dbStatus === "active" ||
          dbStatus === "trialing" ||
          session.payment_status === "paid";

    return NextResponse.json({
      success: true,
      isActive,
      stripeStatus: stripeStatus ?? null,
      dbStatus,
      oneTimePaymentStatus,
      plan: session.metadata?.plan ?? null,
      billingInterval: session.metadata?.billingInterval ?? "month",
      stripeMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message, isActive: false }, { status: 500 });
  }
}
