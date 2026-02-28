import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import { getActiveStripeMode, getStripeClientForMode, resolveStripeMode, type StripeMode } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

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
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, store_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, shop_id, plan, status, stripe_subscription_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
  }));
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

const chooseLegacyTargetSubscription = (rows: SubscriptionRow[], preferredStripeSubscriptionId: string | null) => {
  if (preferredStripeSubscriptionId) {
    const exact = rows.find((row) => row.stripe_subscription_id === preferredStripeSubscriptionId) ?? null;
    if (exact) {
      return exact;
    }
  }

  const unboundActive = rows.find((row) => isSubscriptionUnbound(row) && isActiveLikeStatus(row.status));
  if (unboundActive) {
    return unboundActive;
  }

  const unboundAny = rows.find((row) => isSubscriptionUnbound(row));
  if (unboundAny) {
    return unboundAny;
  }

  const activeAny = rows.find((row) => isActiveLikeStatus(row.status));
  if (activeAny) {
    return activeAny;
  }

  return rows[0] ?? null;
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

  const targetPriceId = await resolveCheckoutPriceId("pro", currentInterval, { mode: args.mode });
  const currentPriceId = item.price?.id ?? null;

  if (currentPriceId !== targetPriceId) {
    await stripe.subscriptions.update(args.stripeSubscriptionId, {
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
        userId: args.userId,
        storeId: args.storeId,
        shopId: args.storeId,
      },
    });

    return { updated: true as const, currentPriceId, targetPriceId };
  }

  await stripe.subscriptions.update(args.stripeSubscriptionId, {
    metadata: {
      ...subscription.metadata,
      plan: "pro",
      billingInterval: currentInterval,
      userId: args.userId,
      storeId: args.storeId,
      shopId: args.storeId,
    },
  });

  return { updated: true as const, currentPriceId, targetPriceId };
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

  const stripeMode = resolveStripeMode(
    typeof metadata.legacy_stripe_mode === "string" ? metadata.legacy_stripe_mode : null,
    getActiveStripeMode()
  );

  const subscriptions = await loadSubscriptionsForUser(args.userId);
  const target = chooseLegacyTargetSubscription(subscriptions, preferredStripeSubscriptionId);

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

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    legacy_onboarding_required: false,
    legacy_password_set: true,
    legacy_store_setup_completed: true,
    legacy_bound_store_id: args.storeId,
    legacy_target_plan: "pro",
    legacy_onboarding_completed_at: new Date().toISOString(),
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
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as CreateStoreBody;

    const phone = asTrimmedString(body.phone);
    const category = asTrimmedString(body.category) || "Genel";
    const topCategoryId = asTrimmedString(body.topCategoryId) || null;
    const subCategoryId = asTrimmedString(body.subCategoryId) || null;
    const currency = asStoreCurrency(body.currency);
    const fallbackPrefix = asTrimmedString(body.fallbackStoreNamePrefix) || "Magazam";
    const requestedStoreName = asTrimmedString(body.storeName);
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
    }

    return NextResponse.json({
      id: storeId,
      storeName,
      linkedLegacySubscriptionId: legacyBinding?.subscriptionId ?? null,
      linkedStripeSubscriptionId: legacyBinding?.stripeSubscriptionId ?? null,
      stripeUpdatedToPro: legacyBinding?.stripeUpdated ?? false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
