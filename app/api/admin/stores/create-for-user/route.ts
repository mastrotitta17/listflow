import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { getStripeClientForMode } from "@/lib/stripe/client";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";

type CreateStoreForUserBody = {
  userId?: unknown;
  storeName?: unknown;
  phone?: unknown;
  category?: unknown;
  topCategoryId?: unknown;
  subCategoryId?: unknown;
  currency?: unknown;
  priceCents?: unknown;
  fallbackStoreNamePrefix?: unknown;
  grantPlan?: unknown;
};

type StoreCurrency = "USD" | "TRY";
type BillingPlan = "standard" | "pro" | "turbo";

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

const asBillingPlan = (value: unknown): BillingPlan | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "starter") {
    return "standard";
  }

  if (normalized === "standard" || normalized === "pro" || normalized === "turbo") {
    return normalized;
  }

  return null;
};

const PLAN_PRICE_CENTS: Record<BillingPlan, number> = {
  standard: 2990,
  pro: 4990,
  turbo: 7990,
};

const toIsoDate = (value: number | null | undefined) => {
  if (!value) {
    return null;
  }
  return new Date(value * 1000).toISOString();
};

const toNextMonthUnix = () => {
  const now = new Date();
  const next = new Date(now);
  next.setMonth(next.getMonth() + 1);
  if (next.getTime() <= now.getTime()) {
    return Math.floor((now.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000);
  }
  return Math.floor(next.getTime() / 1000);
};

const isStripeMissingCustomerError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes("no such customer");
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

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
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

  await supabaseAdmin
    .from("profiles")
    .update({
      phone,
    })
    .eq("user_id", userId);
};

const resolveUserEmail = async (userId: string) => {
  const profileQuery = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ email?: string | null }>();

  if (!profileQuery.error) {
    const email = (profileQuery.data?.email ?? "").trim().toLowerCase();
    if (email) {
      return email;
    }
  }

  const authUser = await supabaseAdmin.auth.admin.getUserById(userId);
  const authEmail = (authUser.data.user?.email ?? "").trim().toLowerCase();
  return authEmail || null;
};

const resolveStripeCustomerId = async (userId: string, email: string | null) => {
  const stripe = getStripeClientForMode();

  const fromSubscriptions = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .not("stripe_customer_id", "is", null)
    .limit(20);

  if (!fromSubscriptions.error) {
    const candidateIds = Array.from(
      new Set(
        (fromSubscriptions.data ?? [])
          .map((row) => ((row as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? "").trim())
          .filter((value) => Boolean(value))
      )
    );

    for (const candidateId of candidateIds) {
      try {
        const retrieved = await stripe.customers.retrieve(candidateId);
        if (!("deleted" in retrieved && retrieved.deleted)) {
          return retrieved.id;
        }
      } catch (error) {
        if (!isStripeMissingCustomerError(error)) {
          throw error;
        }
      }
    }
  }

  if (email) {
    const listed = await stripe.customers.list({
      email,
      limit: 1,
    });
    const existing = listed.data[0];
    if (existing && !("deleted" in existing && existing.deleted)) {
      return existing.id;
    }
  }

  const created = await stripe.customers.create({
    email: email ?? undefined,
    metadata: {
      userId,
      source: "admin_store_create",
    },
  });

  return created.id;
};

const createDeferredStripeSubscription = async (args: {
  userId: string;
  storeId: string;
  plan: BillingPlan;
  currency: StoreCurrency;
}) => {
  const priceId = await resolveCheckoutPriceId(args.plan, "month", {
    currency: args.currency,
  });
  if (!priceId) {
    throw new Error(`Stripe fiyatı bulunamadı: ${args.plan}/month`);
  }

  const email = await resolveUserEmail(args.userId);
  const stripeCustomerId = await resolveStripeCustomerId(args.userId, email);
  const trialEndUnix = toNextMonthUnix();

  const stripe = getStripeClientForMode();
  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    collection_method: "charge_automatically",
    trial_end: trialEndUnix,
    items: [{ price: priceId, quantity: 1 }],
    metadata: {
      userId: args.userId,
      shopId: args.storeId,
      plan: args.plan,
      billingInterval: "month",
      adminGrant: "true",
    },
  });

  const periodEndUnix =
    subscription.items.data[0]?.current_period_end ??
    subscription.trial_end ??
    null;

  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : stripeCustomerId,
    status: subscription.status,
    currentPeriodEnd: toIsoDate(periodEndUnix),
    trialEnd: toIsoDate(subscription.trial_end ?? null),
  };
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
  status: "pending" | "active";
}) => {
  const requiredInsertPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.userId,
    store_name: payload.storeName,
    status: payload.status,
  };

  const optionalInsertPayload: Record<string, unknown> = {
    category: payload.category,
    price_cents: payload.priceCents,
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

const insertStoreSubscriptionRecord = async (args: {
  userId: string;
  storeId: string;
  plan: BillingPlan;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: string;
  currentPeriodEnd: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const requiredPayload: Record<string, unknown> = {
    user_id: args.userId,
    plan: args.plan,
    status: args.status,
  };
  const optionalPayload: Record<string, unknown> = {
    store_id: args.storeId,
    shop_id: args.storeId,
    current_period_end: args.currentPeriodEnd,
    stripe_subscription_id: args.stripeSubscriptionId,
    stripe_customer_id: args.stripeCustomerId,
    updated_at: nowIso,
  };

  const payload: Record<string, unknown> = {
    ...requiredPayload,
    ...optionalPayload,
  };

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const insertResult = await supabaseAdmin
      .from("subscriptions")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!insertResult.error) {
      return insertResult.data?.id ?? null;
    }

    if (isMissingRelationError(insertResult.error)) {
      return null;
    }

    const removableKey = Object.keys(payload).find(
      (key) =>
        !Object.prototype.hasOwnProperty.call(requiredPayload, key) &&
        isMissingColumnError(insertResult.error, key)
    );

    if (!removableKey) {
      throw new Error(insertResult.error.message || "Store subscription could not be created.");
    }

    delete payload[removableKey];
  }

  throw new Error("Store subscription could not be created.");
};

const updateStoreStatus = async (storeId: string, status: "pending" | "active") => {
  const withTimestamp = await supabaseAdmin
    .from("stores")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", storeId);

  if (!withTimestamp.error) {
    return;
  }

  if (!isMissingColumnError(withTimestamp.error, "updated_at")) {
    throw new Error(withTimestamp.error.message || "Store status update failed");
  }

  const fallback = await supabaseAdmin
    .from("stores")
    .update({ status })
    .eq("id", storeId);

  if (fallback.error) {
    throw new Error(fallback.error.message || "Store status update failed");
  }
};

const validateTargetUser = async (userId: string) => {
  const profileQuery = await supabaseAdmin
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (!profileQuery.error) {
    return Boolean(profileQuery.data);
  }

  if (!isMissingRelationError(profileQuery.error)) {
    throw new Error(profileQuery.error.message);
  }

  const userQuery = await supabaseAdmin.auth.admin.getUserById(userId);
  return Boolean(userQuery.data.user);
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as CreateStoreForUserBody;

    const userId = asTrimmedString(body.userId);
    if (!isUuid(userId)) {
      return NextResponse.json({ error: "Geçerli bir kullanıcı seçmelisin." }, { status: 400 });
    }

    const targetExists = await validateTargetUser(userId);
    if (!targetExists) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
    }

    const phone = normalizePhoneForStorage(body.phone);

    const category = asTrimmedString(body.category) || "Genel";
    const topCategoryId = asTrimmedString(body.topCategoryId) || null;
    const subCategoryId = asTrimmedString(body.subCategoryId) || null;
    const currency = asStoreCurrency(body.currency);
    const grantPlan = asBillingPlan(body.grantPlan);
    const fallbackPrefix = asTrimmedString(body.fallbackStoreNamePrefix) || "Mağaza";
    const requestedStoreName = normalizeStoreNameInput(asTrimmedString(body.storeName));
    const existingCount = requestedStoreName ? 0 : await countUserStores(userId);
    const storeName = requestedStoreName || `${fallbackPrefix} ${existingCount + 1}`;
    const storeId = randomUUID();
    const planPriceCents = grantPlan ? PLAN_PRICE_CENTS[grantPlan] : null;
    const priceCents = planPriceCents ?? asSafePrice(body.priceCents);

    if (phone) {
      await tryProfilePhoneSync(userId, phone);
    }

    const insertError = await insertStore({
      id: storeId,
      userId,
      storeName,
      phone: phone || null,
      category,
      topCategoryId,
      subCategoryId,
      currency,
      priceCents,
      status: "pending",
    });

    if (insertError) {
      return NextResponse.json({ error: insertError }, { status: 500 });
    }

    let grantedSubscriptionId: string | null = null;
    let stripeSubscriptionId: string | null = null;
    let nextChargeAt: string | null = null;
    if (grantPlan) {
      const stripeSubscription = await createDeferredStripeSubscription({
        userId,
        storeId,
        plan: grantPlan,
        currency,
      });

      stripeSubscriptionId = stripeSubscription.stripeSubscriptionId;
      nextChargeAt = stripeSubscription.trialEnd;
      grantedSubscriptionId = await insertStoreSubscriptionRecord({
        userId,
        storeId,
        plan: grantPlan,
        stripeSubscriptionId: stripeSubscription.stripeSubscriptionId,
        stripeCustomerId: stripeSubscription.stripeCustomerId,
        status: stripeSubscription.status,
        currentPeriodEnd: stripeSubscription.currentPeriodEnd,
      });

      await updateStoreStatus(storeId, "active");
    }

    return NextResponse.json({
      id: storeId,
      storeName,
      grantedPlan: grantPlan,
      grantedSubscriptionId,
      stripeSubscriptionId,
      nextChargeAt,
      userId,
      createdBy: admin.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
