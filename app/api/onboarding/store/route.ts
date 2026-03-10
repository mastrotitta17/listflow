import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  consumeLegacyOnboardingToken,
  resolveLegacyOnboardingRequestUser,
} from "@/lib/auth/legacy-onboarding";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import { getActiveStripeMode, getStripeClientForMode, resolveStripeMode, type StripeMode } from "@/lib/stripe/client";
import { syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

export const runtime = "nodejs";

type CreateStoreBody = {
  storeName?: unknown;
  phone?: unknown;
  category?: unknown;
  topCategoryId?: unknown;
  subCategoryId?: unknown;
  currency?: unknown;
  priceCents?: unknown;
  fallbackStoreNamePrefix?: unknown;
  legacyLinkProSubscription?: unknown;
};

type StoreCurrency = "USD" | "TRY";

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  stripe_mode?: string | null;
  stripe_customer_id?: string | null;
  plan?: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const asTrimmedString = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const asSafePrice = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 2990;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : 2990;
};

const asStoreCurrency = (value: unknown): StoreCurrency => {
  if (typeof value !== "string") {
    return "USD";
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "TRY") {
    return "TRY";
  }

  return "USD";
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

    if (!isRecoverableColumnError(query.error, ["title_tr", "title_en", "title"])) {
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

type ActiveWebhookCandidate = {
  id: string;
  targetUrl: string | null;
  scope: string | null;
  enabled: boolean | null;
  productId: string | null;
  currency: "USD" | "TRY" | null;
};

const loadActiveAutomationWebhookCandidates = async (): Promise<ActiveWebhookCandidate[]> => {
  const candidates: Array<{
    select: string;
    hasScope: boolean;
    hasEnabled: boolean;
    hasProduct: boolean;
    hasCurrency: boolean;
  }> = [
    { select: "id,target_url,scope,enabled,product_id,currency", hasScope: true, hasEnabled: true, hasProduct: true, hasCurrency: true },
    { select: "id,target_url,scope,enabled,product_id", hasScope: true, hasEnabled: true, hasProduct: true, hasCurrency: false },
    { select: "id,target_url,scope,enabled,currency", hasScope: true, hasEnabled: true, hasProduct: false, hasCurrency: true },
    { select: "id,target_url,scope,enabled", hasScope: true, hasEnabled: true, hasProduct: false, hasCurrency: false },
    { select: "id,target_url,enabled,product_id,currency", hasScope: false, hasEnabled: true, hasProduct: true, hasCurrency: true },
    { select: "id,target_url,enabled,product_id", hasScope: false, hasEnabled: true, hasProduct: true, hasCurrency: false },
    { select: "id,target_url,enabled,currency", hasScope: false, hasEnabled: true, hasProduct: false, hasCurrency: true },
    { select: "id,target_url,enabled", hasScope: false, hasEnabled: true, hasProduct: false, hasCurrency: false },
    { select: "id,target_url,scope,product_id,currency", hasScope: true, hasEnabled: false, hasProduct: true, hasCurrency: true },
    { select: "id,target_url,scope,product_id", hasScope: true, hasEnabled: false, hasProduct: true, hasCurrency: false },
    { select: "id,target_url,scope,currency", hasScope: true, hasEnabled: false, hasProduct: false, hasCurrency: true },
    { select: "id,target_url,scope", hasScope: true, hasEnabled: false, hasProduct: false, hasCurrency: false },
    { select: "id,target_url", hasScope: false, hasEnabled: false, hasProduct: false, hasCurrency: false },
  ];

  for (const candidate of candidates) {
    const query = await supabaseAdmin.from("webhook_configs").select(candidate.select).limit(5000);
    if (query.error) {
      if (!isRecoverableColumnError(query.error, ["scope", "enabled", "product_id", "currency"])) {
        throw new Error(query.error.message);
      }
      continue;
    }

    const rows = (query.data ?? []) as unknown as Array<{
      id: string;
      target_url?: string | null;
      scope?: string | null;
      enabled?: boolean | null;
      product_id?: string | null;
      currency?: string | null;
    }>;

    return rows
      .map((row) => ({
        id: row.id,
        targetUrl: row.target_url ?? null,
        scope: candidate.hasScope ? row.scope ?? "automation" : "automation",
        enabled: candidate.hasEnabled ? row.enabled ?? true : true,
        productId: candidate.hasProduct ? row.product_id ?? null : null,
        currency: candidate.hasCurrency ? normalizeStoreCurrency(row.currency ?? null) : null,
      }))
      .filter((row) => row.enabled !== false && row.scope !== "generic" && Boolean(row.targetUrl));
  }

  return [];
};

const resolveWebhookForAutoBinding = async (args: {
  productId: string | null;
  category: string;
  currency: StoreCurrency;
}) => {
  const webhookRows = await loadActiveAutomationWebhookCandidates();
  if (!webhookRows.length) {
    return { webhookConfigId: null as string | null, resolvedProductId: args.productId ?? null };
  }

  const preferredCurrency = normalizeStoreCurrency(args.currency);
  const resolvedProductId =
    (args.productId && isUuid(args.productId) ? args.productId : null) ??
    (await resolveProductIdByStoreCategory(args.category));

  if (resolvedProductId) {
    const directMatches = webhookRows.filter((row) => row.productId === resolvedProductId);
    if (directMatches.length) {
      return {
        webhookConfigId: pickWebhookIdByCurrencyPreference(directMatches, preferredCurrency),
        resolvedProductId,
      };
    }

    const map = await loadWebhookConfigProductMap(webhookRows.map((row) => row.id));
    const mappedMatches = webhookRows.filter((row) => map.get(row.id) === resolvedProductId);
    if (mappedMatches.length) {
      return {
        webhookConfigId: pickWebhookIdByCurrencyPreference(mappedMatches, preferredCurrency),
        resolvedProductId,
      };
    }
  }

  const singleton = (() => {
    if (!preferredCurrency) {
      return webhookRows.length === 1 ? webhookRows[0].id : null;
    }

    const exact = webhookRows.filter((row) => row.currency === preferredCurrency);
    if (exact.length === 1) {
      return exact[0].id;
    }
    if (exact.length > 1) {
      return null;
    }

    const generic = webhookRows.filter((row) => row.currency === null);
    return generic.length === 1 ? generic[0].id : null;
  })();

  return {
    webhookConfigId: singleton,
    resolvedProductId,
  };
};

const updateStoreAutoBinding = async (args: {
  storeId: string;
  webhookConfigId: string;
  productId: string | null;
  userId: string;
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
    const update = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);
    if (!update.error) {
      return;
    }

    if (!isRecoverableColumnError(update.error, ["active_webhook_config_id", "product_id", "automation_updated_at", "automation_updated_by"])) {
      throw new Error(update.error.message);
    }
  }
};

const persistStoreWebhookAutoBindingLog = async (args: {
  storeId: string;
  webhookConfigId: string;
  userId: string;
}) => {
  const payload = {
    store_id: args.storeId,
    webhook_config_id: args.webhookConfigId,
    idempotency_key: `auto_bind:${args.storeId}:${args.webhookConfigId}:${Date.now()}`,
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      request_url: "store-webhook-mapping-auto-bind",
      request_method: "STORE_WEBHOOK_MAP",
      request_headers: {},
      request_body: payload,
      response_status: 200,
      response_body: "mapping_saved",
      duration_ms: 0,
      created_by: args.userId,
    },
    {
      request_url: "store-webhook-mapping-auto-bind",
      request_method: "STORE_WEBHOOK_MAP",
      request_body: payload,
    },
  ];

  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(candidate);
    if (!error) {
      return;
    }

    if (!isRecoverableColumnError(error, ["request_headers", "response_status", "response_body", "duration_ms", "created_by"])) {
      throw new Error(error.message);
    }
  }
};

const autoBindStoreAutomationWebhook = async (args: {
  storeId: string;
  userId: string;
  productId: string | null;
  category: string;
  currency: StoreCurrency;
}) => {
  const resolved = await resolveWebhookForAutoBinding({
    productId: args.productId,
    category: args.category,
    currency: args.currency,
  });

  if (!resolved.webhookConfigId) {
    return null;
  }

  await updateStoreAutoBinding({
    storeId: args.storeId,
    webhookConfigId: resolved.webhookConfigId,
    productId: resolved.resolvedProductId,
    userId: args.userId,
  });

  await persistStoreWebhookAutoBindingLog({
    storeId: args.storeId,
    webhookConfigId: resolved.webhookConfigId,
    userId: args.userId,
  });

  return resolved.webhookConfigId;
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

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes("relation") &&
    (error.message ?? "").toLowerCase().includes("does not exist");
};

const tryProfilePhoneSync = async (userId: string, phone: string) => {
  const nowIso = new Date().toISOString();

  const withTimestamp = await supabaseAdmin
    .from("profiles")
    .update({
      phone,
      updated_at: nowIso,
    })
    .eq("user_id", userId);

  if (!withTimestamp.error) {
    return;
  }

  if (!isMissingColumnError(withTimestamp.error, "updated_at") && !isMissingColumnError(withTimestamp.error, "phone")) {
    return;
  }

  const withoutTimestamp = await supabaseAdmin
    .from("profiles")
    .update({
      phone,
    })
    .eq("user_id", userId);

  if (withoutTimestamp.error) {
    return;
  }
};

const toIsoDateFromUnix = (value: number | null | undefined) => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const insertStore = async (payload: {
  id: string;
  userId: string;
  storeName: string;
  phone: string | null;
  category: string;
  topCategoryId: string | null;
  subCategoryId: string | null;
  currency: StoreCurrency;
  priceCents: number;
}) => {
  const requiredInsertPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.userId,
    store_name: payload.storeName,
    status: "pending",
  };

  const optionalInsertPayload: Record<string, unknown> = {
    category: payload.category,
    price_cents: payload.priceCents,
    product_id: payload.subCategoryId && isUuid(payload.subCategoryId) ? payload.subCategoryId : null,
    category_id: payload.topCategoryId,
    sub_category_id: payload.subCategoryId,
    subcategory_id: payload.subCategoryId,
    currency: payload.currency.toLowerCase(),
    store_currency: payload.currency,
  };

  if (payload.phone) {
    optionalInsertPayload.phone = payload.phone;
  }

  const candidatePayload: Record<string, unknown> = {
    ...requiredInsertPayload,
    ...optionalInsertPayload,
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const insertResult = await supabaseAdmin.from("stores").insert(candidatePayload);
    if (!insertResult.error) {
      return null;
    }

    if (isMissingRelationError(insertResult.error)) {
      return "Table public.stores does not exist in remote schema.";
    }

    const removableKey = Object.keys(candidatePayload).find(
      (key) => !Object.prototype.hasOwnProperty.call(requiredInsertPayload, key) && isMissingColumnError(insertResult.error, key)
    );

    if (!removableKey) {
      return insertResult.error.message || "Store creation failed";
    }

    delete candidatePayload[removableKey];
  }

  return "Store creation failed";
};

const countUserStores = async (userId: string) => {
  const { count } = await supabaseAdmin
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return typeof count === "number" ? count : 0;
};

const loadSubscriptionsForUser = async (userId: string): Promise<SubscriptionRow[]> => {
  const candidates = [
    {
      select: "id, user_id, store_id, shop_id, stripe_mode, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: true,
    },
    {
      select: "id, user_id, shop_id, stripe_mode, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: true,
    },
    {
      select: "id, user_id, store_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: false,
    },
    {
      select: "id, user_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    const attempt = await supabaseAdmin
      .from("subscriptions")
      .select(candidate.select)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (!attempt.error) {
      return (((attempt.data ?? []) as unknown) as SubscriptionRow[]).map((row) => ({
        ...row,
        stripe_mode: candidate.hasStripeMode ? row.stripe_mode ?? null : null,
        store_id: candidate.hasStoreId ? row.store_id ?? null : row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
      }));
    }

    lastError = attempt.error.message;
    if (!isRecoverableColumnError(attempt.error, ["store_id", "stripe_mode"])) {
      throw new Error(attempt.error.message);
    }
  }

  throw new Error(lastError ?? "subscriptions could not be loaded");
};

const getStoreReference = (row: SubscriptionRow) => {
  if (row.store_id) {
    return row.store_id;
  }

  if (row.shop_id && isUuid(row.shop_id)) {
    return row.shop_id;
  }

  return null;
};

const isSubscriptionUnbound = (row: SubscriptionRow) => !getStoreReference(row);

const isActiveLikeStatus = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "active" || normalized === "trialing";
};

const chooseLegacyTargetSubscription = (
  rows: SubscriptionRow[],
  preferredStripeSubscriptionId: string | null,
  preferredStripeMode: StripeMode
) => {
  const modeFiltered = rows.filter((row) => {
    if (!row.stripe_mode) {
      return true;
    }
    return row.stripe_mode === preferredStripeMode;
  });
  const candidates = modeFiltered.length ? modeFiltered : rows;

  if (preferredStripeSubscriptionId) {
    const exact = candidates.find((row) => row.stripe_subscription_id === preferredStripeSubscriptionId) ?? null;
    if (exact) {
      return exact;
    }
  }

  const unboundActive = candidates.find((row) => isSubscriptionUnbound(row) && isActiveLikeStatus(row.status));
  if (unboundActive) {
    return unboundActive;
  }

  const unboundAny = candidates.find((row) => isSubscriptionUnbound(row));
  if (unboundAny) {
    return unboundAny;
  }

  const activeAny = candidates.find((row) => isActiveLikeStatus(row.status));
  if (activeAny) {
    return activeAny;
  }

  return candidates[0] ?? null;
};

const findSubscriptionRowByField = async (
  field: "stripe_subscription_id" | "stripe_customer_id",
  value: string
): Promise<SubscriptionRow | null> => {
  const normalizedValue = asTrimmedString(value);
  if (!normalizedValue) {
    return null;
  }

  const candidates = [
    {
      select:
        "id, user_id, store_id, shop_id, stripe_mode, stripe_customer_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: true,
      hasStripeCustomer: true,
    },
    {
      select:
        "id, user_id, shop_id, stripe_mode, stripe_customer_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: true,
      hasStripeCustomer: true,
    },
    {
      select:
        "id, user_id, store_id, shop_id, stripe_customer_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: false,
      hasStripeCustomer: true,
    },
    {
      select:
        "id, user_id, shop_id, stripe_customer_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: false,
      hasStripeCustomer: true,
    },
    {
      select: "id, user_id, store_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: false,
      hasStripeCustomer: false,
    },
    {
      select: "id, user_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: false,
      hasStripeCustomer: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    const table = supabaseAdmin.from("subscriptions") as any;
    const baseQuery = table
      .select(candidate.select)
      .order("updated_at", { ascending: false })
      .limit(1);

    const attempt =
      field === "stripe_subscription_id"
        ? await baseQuery.eq("stripe_subscription_id", normalizedValue).maybeSingle()
        : await baseQuery.eq("stripe_customer_id", normalizedValue).maybeSingle();

    if (!attempt.error) {
      if (!attempt.data) {
        return null;
      }
      const row = attempt.data;
      return {
        ...row,
        stripe_mode: candidate.hasStripeMode ? row.stripe_mode ?? null : null,
        stripe_customer_id: candidate.hasStripeCustomer ? row.stripe_customer_id ?? null : null,
        store_id: candidate.hasStoreId ? row.store_id ?? null : row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
      };
    }

    lastError = attempt.error.message;
    if (!isRecoverableColumnError(attempt.error, ["store_id", "stripe_mode", "stripe_customer_id"])) {
      throw new Error(attempt.error.message);
    }
  }

  if (lastError) {
    throw new Error(lastError);
  }

  return null;
};

const claimSubscriptionForLegacyUser = async (args: {
  subscriptionId: string;
  userId: string;
  stripeMode: StripeMode;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string>> = [
    { user_id: args.userId, stripe_mode: args.stripeMode, updated_at: nowIso },
    { user_id: args.userId, stripe_mode: args.stripeMode },
    { user_id: args.userId, updated_at: nowIso },
    { user_id: args.userId },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const result = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", args.subscriptionId)
      .select("id")
      .maybeSingle<{ id: string }>();
    const updateError = result.error;

    if (!updateError) {
      if (result.data?.id) {
        return true;
      }
      lastError = "Subscription row not found.";
      continue;
    }

    if (isRecoverableColumnError(updateError, ["stripe_mode", "updated_at"])) {
      lastError = updateError.message;
      continue;
    }

    throw new Error(updateError.message);
  }

  if (lastError) {
    throw new Error(lastError);
  }

  return false;
};

const insertFallbackLegacySubscription = async (args: {
  userId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  stripeMode: StripeMode;
}) => {
  if (!args.stripeSubscriptionId && !args.stripeCustomerId) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const payload: Record<string, string | null> = {
    user_id: args.userId,
    shop_id: null,
    store_id: null,
    plan: "pro",
    status: "active",
    stripe_customer_id: args.stripeCustomerId,
    stripe_subscription_id: args.stripeSubscriptionId,
    stripe_mode: args.stripeMode,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const optionalKeys = new Set(["store_id", "stripe_customer_id", "stripe_mode", "created_at", "updated_at"]);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabaseAdmin
      .from("subscriptions")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!result.error) {
      return true;
    }

    const removableKey = Object.keys(payload).find(
      (key) => optionalKeys.has(key) && isMissingColumnError(result.error, key)
    );
    if (removableKey) {
      delete payload[removableKey];
      continue;
    }

    return false;
  }

  return false;
};

const updateSubscriptionAsProAndBindStore = async (args: {
  subscriptionId: string;
  userId: string;
  storeId: string;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string>> = [
    { store_id: args.storeId, shop_id: args.storeId, plan: "pro", updated_at: nowIso },
    { store_id: args.storeId, shop_id: args.storeId, plan: "pro" },
    { shop_id: args.storeId, plan: "pro", updated_at: nowIso },
    { shop_id: args.storeId, plan: "pro" },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const result = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", args.subscriptionId)
      .eq("user_id", args.userId)
      .select("id")
      .maybeSingle<{ id: string }>();
    const updateError = result.error;

    if (!updateError) {
      if (result.data?.id) {
        return;
      }

      lastError = "Subscription record not found for user.";
      continue;
    }

    if (isRecoverableColumnError(updateError, ["store_id", "shop_id", "plan", "updated_at"])) {
      lastError = updateError.message;
      continue;
    }

    throw new Error(updateError.message);
  }

  throw new Error(lastError ?? "Subscription could not be linked to store.");
};

const setStoreAsPro = async (args: { storeId: string; userId: string }) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string | number>> = [
    { status: "active", price_cents: 4990, updated_at: nowIso },
    { status: "active", price_cents: 4990 },
    { status: "active", updated_at: nowIso },
    { status: "active" },
  ];

  for (const payload of payloads) {
    const result = await supabaseAdmin
      .from("stores")
      .update(payload)
      .eq("id", args.storeId)
      .eq("user_id", args.userId);
    const updateError = result.error;

    if (!updateError) {
      return;
    }

    if (!isRecoverableColumnError(updateError, ["price_cents", "status", "updated_at"])) {
      throw new Error(updateError.message);
    }
  }
};

const isStripeCurrencyMismatchError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const directMessage =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  const raw = (error as { raw?: { message?: unknown } }).raw;
  const rawMessage = raw && typeof raw.message === "string" ? raw.message : "";
  const message = `${directMessage} ${rawMessage}`.toLowerCase();

  return (
    (message.includes("only supports") && message.includes("currency")) ||
    message.includes("expected currency")
  );
};

const updateStripeSubscriptionToPro = async (args: {
  stripeSubscriptionId: string | null;
  mode: StripeMode;
  storeId: string;
  userId: string;
}) => {
  if (!args.stripeSubscriptionId) {
    return { updated: false as const };
  }

  const stripe = getStripeClientForMode(args.mode);
  const subscription = await stripe.subscriptions.retrieve(args.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  const item = subscription.items.data[0];
  const currentInterval = item?.price?.recurring?.interval;

  if (!item || (currentInterval !== "month" && currentInterval !== "year")) {
    throw new Error("Stripe subscription interval could not be resolved.");
  }

  const targetPriceId = await resolveCheckoutPriceId("pro", currentInterval, {
    mode: args.mode,
    currency: "usd",
  });
  if (!targetPriceId) {
    throw new Error("Stripe USD pro fiyatı bulunamadı.");
  }
  const currentPriceId = item.price?.id ?? null;
  let finalSubscription = subscription;

  try {
    if (currentPriceId !== targetPriceId) {
      finalSubscription = await stripe.subscriptions.update(args.stripeSubscriptionId, {
        proration_behavior: "none",
        items: [
          {
            id: item.id,
            price: targetPriceId,
          },
        ],
        metadata: {
          ...subscription.metadata,
          plan: "pro",
          billingInterval: currentInterval,
          billingCurrency: "usd",
          userId: args.userId,
          storeId: args.storeId,
          shopId: args.storeId,
        },
      });
    } else {
      finalSubscription = await stripe.subscriptions.update(args.stripeSubscriptionId, {
        metadata: {
          ...subscription.metadata,
          plan: "pro",
          billingInterval: currentInterval,
          billingCurrency: "usd",
          userId: args.userId,
          storeId: args.storeId,
          shopId: args.storeId,
        },
      });
    }
  } catch (error) {
    if (!isStripeCurrencyMismatchError(error)) {
      throw error;
    }

    const existingCustomerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id ?? null;
    let existingCustomerEmail: string | null = null;

    if (existingCustomerId) {
      try {
        const existingCustomer = await stripe.customers.retrieve(existingCustomerId);
        if (!("deleted" in existingCustomer && existingCustomer.deleted)) {
          existingCustomerEmail = existingCustomer.email ?? null;
        }
      } catch {
        // no-op
      }
    }

    const replacementCustomer = await stripe.customers.create({
      email: existingCustomerEmail ?? undefined,
      metadata: {
        userId: args.userId,
        storeId: args.storeId,
        source: "legacy_onboarding_currency_migration",
      },
    });

    const nowUnix = Math.floor(Date.now() / 1000);
    const periodEndUnix =
      item.current_period_end ??
      subscription.trial_end ??
      null;
    const replacementTrialEnd =
      typeof periodEndUnix === "number" && periodEndUnix > nowUnix + 120
        ? periodEndUnix
        : undefined;

    finalSubscription = await stripe.subscriptions.create({
      customer: replacementCustomer.id,
      collection_method: "charge_automatically",
      ...(replacementTrialEnd ? { trial_end: replacementTrialEnd } : {}),
      items: [{ price: targetPriceId, quantity: 1 }],
      metadata: {
        ...subscription.metadata,
        plan: "pro",
        billingInterval: currentInterval,
        billingCurrency: "usd",
        userId: args.userId,
        storeId: args.storeId,
        shopId: args.storeId,
        migratedFromSubscriptionId: args.stripeSubscriptionId,
        migratedAt: new Date().toISOString(),
      },
    });

    await stripe.subscriptions.update(args.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: {
        ...subscription.metadata,
        migratedToSubscriptionId: finalSubscription.id,
        migratedToCurrency: "usd",
        migratedAt: new Date().toISOString(),
      },
    });
  }

  const stripeCustomerId =
    typeof finalSubscription.customer === "string"
      ? finalSubscription.customer
      : finalSubscription.customer?.id ?? null;
  const currentPeriodEndIso = toIsoDateFromUnix(
    finalSubscription.items.data[0]?.current_period_end ??
      finalSubscription.trial_end ??
      null
  );

  return {
    updated: true as const,
    currentPriceId,
    targetPriceId,
    status: finalSubscription.status,
    currentPeriodEnd: currentPeriodEndIso,
    stripeCustomerId,
    stripeMode: finalSubscription.livemode ? "live" : "test",
  };
};

const syncLegacyLinkedSubscriptionRow = async (args: {
  subscriptionId: string;
  userId: string;
  storeId: string;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeMode: StripeMode;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      store_id: args.storeId,
      shop_id: args.storeId,
      plan: "pro",
      status: args.status ?? "active",
      current_period_end: args.currentPeriodEnd,
      stripe_customer_id: args.stripeCustomerId,
      stripe_mode: args.stripeMode,
      updated_at: nowIso,
    },
    {
      user_id: args.userId,
      store_id: args.storeId,
      shop_id: args.storeId,
      plan: "pro",
      status: args.status ?? "active",
      current_period_end: args.currentPeriodEnd,
      stripe_customer_id: args.stripeCustomerId,
      updated_at: nowIso,
    },
    {
      user_id: args.userId,
      shop_id: args.storeId,
      plan: "pro",
      status: args.status ?? "active",
      current_period_end: args.currentPeriodEnd,
      stripe_customer_id: args.stripeCustomerId,
      updated_at: nowIso,
    },
  ];

  for (const payload of payloads) {
    const result = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", args.subscriptionId)
      .eq("user_id", args.userId);

    if (!result.error) {
      await syncProfileSubscriptionState({
        userId: args.userId,
        status: (payload.status as string) ?? null,
        plan: "pro",
        stripeCustomerId: args.stripeCustomerId,
      });
      return;
    }

    if (
      !isRecoverableColumnError(result.error, [
        "store_id",
        "shop_id",
        "plan",
        "status",
        "current_period_end",
        "stripe_customer_id",
        "stripe_mode",
        "updated_at",
      ])
    ) {
      throw new Error(result.error.message);
    }
  }
};

const bindLegacyProSubscriptionToStore = async (args: { userId: string; storeId: string }) => {
  const authUserResult = await supabaseAdmin.auth.admin.getUserById(args.userId);
  if (authUserResult.error || !authUserResult.data.user) {
    throw new Error(authUserResult.error?.message ?? "User could not be loaded for legacy binding.");
  }

  const authUser = authUserResult.data.user;
  const metadata =
    typeof authUser.user_metadata === "object" && authUser.user_metadata !== null
      ? (authUser.user_metadata as Record<string, unknown>)
      : {};

  const preferredStripeSubscriptionId =
    typeof metadata.legacy_stripe_subscription_id === "string"
      ? metadata.legacy_stripe_subscription_id.trim() || null
      : null;
  const preferredStripeCustomerId =
    typeof metadata.legacy_stripe_customer_id === "string"
      ? metadata.legacy_stripe_customer_id.trim() || null
      : null;

  const stripeMode = resolveStripeMode(
    typeof metadata.legacy_stripe_mode === "string" ? metadata.legacy_stripe_mode : null,
    getActiveStripeMode()
  );

  let subscriptions = await loadSubscriptionsForUser(args.userId);
  let target = chooseLegacyTargetSubscription(subscriptions, preferredStripeSubscriptionId, stripeMode);

  if (!target && preferredStripeSubscriptionId) {
    const located = await findSubscriptionRowByField("stripe_subscription_id", preferredStripeSubscriptionId);
    if (located?.id) {
      await claimSubscriptionForLegacyUser({
        subscriptionId: located.id,
        userId: args.userId,
        stripeMode,
      });
      subscriptions = await loadSubscriptionsForUser(args.userId);
      target = chooseLegacyTargetSubscription(subscriptions, preferredStripeSubscriptionId, stripeMode);
    }
  }

  if (!target && preferredStripeCustomerId) {
    const located = await findSubscriptionRowByField("stripe_customer_id", preferredStripeCustomerId);
    if (located?.id) {
      await claimSubscriptionForLegacyUser({
        subscriptionId: located.id,
        userId: args.userId,
        stripeMode,
      });
      subscriptions = await loadSubscriptionsForUser(args.userId);
      target = chooseLegacyTargetSubscription(subscriptions, preferredStripeSubscriptionId, stripeMode);
    }
  }

  if (!target && (preferredStripeSubscriptionId || preferredStripeCustomerId)) {
    await insertFallbackLegacySubscription({
      userId: args.userId,
      stripeSubscriptionId: preferredStripeSubscriptionId,
      stripeCustomerId: preferredStripeCustomerId,
      stripeMode,
    });
    subscriptions = await loadSubscriptionsForUser(args.userId);
    target = chooseLegacyTargetSubscription(subscriptions, preferredStripeSubscriptionId, stripeMode);
  }

  if (!target) {
    throw new Error("Bağlanacak abonelik bulunamadı.");
  }

  await updateSubscriptionAsProAndBindStore({
    subscriptionId: target.id,
    userId: args.userId,
    storeId: args.storeId,
  });

  await setStoreAsPro({
    storeId: args.storeId,
    userId: args.userId,
  });

  const stripeResult = await updateStripeSubscriptionToPro({
    stripeSubscriptionId: target.stripe_subscription_id ?? null,
    mode: stripeMode,
    storeId: args.storeId,
    userId: args.userId,
  });

  if (stripeResult.updated) {
    await syncLegacyLinkedSubscriptionRow({
      subscriptionId: target.id,
      userId: args.userId,
      storeId: args.storeId,
      status: typeof stripeResult.status === "string" ? stripeResult.status : "active",
      currentPeriodEnd: typeof stripeResult.currentPeriodEnd === "string" ? stripeResult.currentPeriodEnd : null,
      stripeCustomerId: typeof stripeResult.stripeCustomerId === "string" ? stripeResult.stripeCustomerId : null,
      stripeMode: stripeResult.stripeMode === "test" ? "test" : "live",
    });
  }

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    legacy_onboarding_required: false,
    legacy_password_set: true,
    legacy_store_setup_completed: true,
    legacy_bound_store_id: args.storeId,
    legacy_target_plan: "pro",
    legacy_onboarding_completed_at: new Date().toISOString(),
    legacy_onboarding_token: null,
  };

  const metadataUpdate = await supabaseAdmin.auth.admin.updateUserById(args.userId, {
    user_metadata: nextMetadata,
    email_confirm: true,
  });

  if (metadataUpdate.error) {
    throw new Error(metadataUpdate.error.message);
  }

  return {
    subscriptionId: target.id,
    stripeSubscriptionId: target.stripe_subscription_id ?? null,
    stripeUpdated: stripeResult.updated,
  };
};

export async function POST(request: NextRequest) {
  try {
    const resolvedUser = await resolveLegacyOnboardingRequestUser(request);
    if (!resolvedUser) {
      return NextResponse.json({ error: "Unauthorized: invalid onboarding token or access token." }, { status: 401 });
    }
    const user = resolvedUser.user;

    const body = (await request.json().catch(() => ({}))) as CreateStoreBody;

    const phone = normalizePhoneForStorage(body.phone);
    const category = asTrimmedString(body.category) || "Genel";
    const topCategoryId = asTrimmedString(body.topCategoryId) || null;
    const subCategoryId = asTrimmedString(body.subCategoryId) || null;
    const currency = asStoreCurrency(body.currency);
    const fallbackPrefix = asTrimmedString(body.fallbackStoreNamePrefix) || "Magazam";
    const requestedStoreName = normalizeStoreNameInput(asTrimmedString(body.storeName));
    const existingCount = requestedStoreName ? 0 : await countUserStores(user.id);
    const storeName = requestedStoreName || `${fallbackPrefix} ${existingCount + 1}`;
    const storeId = randomUUID();
    const legacyLinkProSubscription = body.legacyLinkProSubscription === true;
    const priceCents = legacyLinkProSubscription ? 4990 : asSafePrice(body.priceCents);

    if (phone) {
      await tryProfilePhoneSync(user.id, phone);
    }

    const insertError = await insertStore({
      id: storeId,
      userId: user.id,
      storeName,
      phone: phone || null,
      category,
      topCategoryId,
      subCategoryId,
      currency,
      priceCents,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError }, { status: 500 });
    }

    let autoBoundWebhookConfigId: string | null = null;
    let automationBootstrapWarning: string | null = null;
    try {
      autoBoundWebhookConfigId = await autoBindStoreAutomationWebhook({
        storeId,
        userId: user.id,
        productId: subCategoryId && isUuid(subCategoryId) ? subCategoryId : null,
        category,
        currency,
      });
    } catch (error) {
      automationBootstrapWarning =
        error instanceof Error ? error.message : "Store webhook otomatik eşlemesi tamamlanamadı.";
    }

    let legacyBinding: {
      subscriptionId: string;
      stripeSubscriptionId: string | null;
      stripeUpdated: boolean;
    } | null = null;

    if (legacyLinkProSubscription) {
      try {
        legacyBinding = await bindLegacyProSubscriptionToStore({
          userId: user.id,
          storeId,
        });
      } catch (error) {
        await supabaseAdmin
          .from("stores")
          .delete()
          .eq("id", storeId)
          .eq("user_id", user.id);

        const message = error instanceof Error ? error.message : "Legacy abonelik mağazaya bağlanamadı.";
        return NextResponse.json({ error: message }, { status: 500 });
      }

      try {
        await syncSchedulerCronJobLifecycle({ force: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cron lifecycle sync failed.";
        automationBootstrapWarning = automationBootstrapWarning
          ? `${automationBootstrapWarning} | ${message}`
          : message;
      }
    }

    await consumeLegacyOnboardingToken(resolvedUser.onboardingToken);

    return NextResponse.json({
      id: storeId,
      storeName,
      linkedLegacySubscriptionId: legacyBinding?.subscriptionId ?? null,
      linkedStripeSubscriptionId: legacyBinding?.stripeSubscriptionId ?? null,
      stripeUpdatedToPro: legacyBinding?.stripeUpdated ?? false,
      autoBoundWebhookConfigId,
      automationBootstrapWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
