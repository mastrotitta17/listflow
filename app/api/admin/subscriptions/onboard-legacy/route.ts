import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

export const runtime = "nodejs";

type OnboardLegacyBody = {
  email?: unknown;
  strategy?: unknown;
  password?: unknown;
  stripeMode?: unknown;
  stripeSubscriptionId?: unknown;
  stripeCustomerId?: unknown;
  storeId?: unknown;
  shopId?: unknown;
  plan?: unknown;
  status?: unknown;
  currentPeriodEnd?: unknown;
};

type OnboardStrategy = "magic_link" | "set_password";
type StripeMode = "live" | "test";

const asTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeEmail = (value: unknown) => asTrimmedString(value).toLowerCase();

const parseStrategy = (value: unknown): OnboardStrategy => {
  const normalized = asTrimmedString(value).toLowerCase();
  return normalized === "set_password" ? "set_password" : "magic_link";
};

const parseStripeMode = (value: unknown): StripeMode | null => {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === "live" || normalized === "test") {
    return normalized;
  }
  return null;
};

const isMissingColumnError = (error: { message?: string; code?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const findAuthUserByEmail = async (email: string) => {
  const normalized = email.toLowerCase();

  for (let page = 1; page <= 50; page += 1) {
    const result = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }

    const users = result.data?.users ?? [];
    const found = users.find((user) => (user.email ?? "").toLowerCase() === normalized) ?? null;
    if (found) {
      return found;
    }

    if (users.length < 200) {
      break;
    }
  }

  return null;
};

const ensureProfile = async (userId: string, email: string) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string>> = [
    { user_id: userId, email, updated_at: nowIso },
    { user_id: userId, email },
  ];

  for (const payload of payloads) {
    const result = await supabaseAdmin
      .from("profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (!result.error) {
      return;
    }

    if (!isMissingColumnError(result.error, "updated_at")) {
      throw new Error(result.error.message);
    }
  }
};

const updateSubscriptionsByField = async (field: "stripe_subscription_id" | "stripe_customer_id", value: string, userId: string) => {
  const nowIso = new Date().toISOString();
  const payloadWithTimestamp: Record<string, string> = { user_id: userId, updated_at: nowIso };
  const payloadWithoutTimestamp: Record<string, string> = { user_id: userId };

  const firstTry = await supabaseAdmin
    .from("subscriptions")
    .update(payloadWithTimestamp)
    .eq(field, value)
    .select("id");

  if (!firstTry.error) {
    return (firstTry.data ?? []).length;
  }

  if (!isMissingColumnError(firstTry.error, "updated_at")) {
    throw new Error(firstTry.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .update(payloadWithoutTimestamp)
    .eq(field, value)
    .select("id");

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return (fallback.data ?? []).length;
};

const insertFallbackSubscription = async (params: {
  userId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  shopId: string | null;
  storeId: string | null;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
}) => {
  if (!params.stripeSubscriptionId && !params.stripeCustomerId) {
    return false;
  }

  const nowIso = new Date().toISOString();

  const basePayload: Record<string, string | null> = {
    user_id: params.userId,
    shop_id: params.shopId ?? params.storeId ?? null,
    store_id: params.storeId ?? null,
    plan: params.plan ?? "standard",
    status: params.status ?? "active",
    stripe_customer_id: params.stripeCustomerId,
    stripe_subscription_id: params.stripeSubscriptionId,
    current_period_end: params.currentPeriodEnd,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const optionalKeys = new Set(["store_id", "created_at", "updated_at", "current_period_end"]);
  const payload = { ...basePayload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabaseAdmin
      .from("subscriptions")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (!result.error) {
      return true;
    }

    const removableKey = Object.keys(payload).find((key) => optionalKeys.has(key) && isMissingColumnError(result.error, key));
    if (removableKey) {
      delete payload[removableKey];
      continue;
    }

    return false;
  }

  return false;
};

const generateAdminMagicLink = async (email: string, appUrl: string) => {
  const generateResult = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${appUrl}/legacy-onboarding`,
    },
  });

  if (generateResult.error) {
    throw new Error(generateResult.error.message);
  }

  const properties = (generateResult.data?.properties ?? {}) as Record<string, unknown>;
  return typeof properties.action_link === "string" ? properties.action_link : null;
};

const dispatchMagicLinkEmail = async (email: string, appUrl: string) => {
  const result = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${appUrl}/legacy-onboarding`,
    },
  });

  return {
    ok: !result.error,
    error: result.error?.message ?? null,
  };
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const appUrl = resolvePublicSiteUrl(request);
    const body = (await request.json().catch(() => ({}))) as OnboardLegacyBody;

    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Geçerli bir e-posta girin." }, { status: 400 });
    }

    const strategy = parseStrategy(body.strategy);
    const stripeMode = parseStripeMode(body.stripeMode);
    const password = asTrimmedString(body.password);

    if (strategy === "set_password" && password.length < 8) {
      return NextResponse.json({ error: "Şifre en az 8 karakter olmalı." }, { status: 400 });
    }

    const stripeSubscriptionId = asTrimmedString(body.stripeSubscriptionId) || null;
    const stripeCustomerId = asTrimmedString(body.stripeCustomerId) || null;
    const storeId = isUuid(asTrimmedString(body.storeId)) ? asTrimmedString(body.storeId) : null;
    const shopId = asTrimmedString(body.shopId) || null;
    const plan = asTrimmedString(body.plan) || null;
    const status = asTrimmedString(body.status) || null;
    const currentPeriodEnd = asTrimmedString(body.currentPeriodEnd) || null;

    let userId: string | null = null;

    const profileLookup = await supabaseAdmin
      .from("profiles")
      .select("user_id,email")
      .ilike("email", email)
      .limit(1)
      .maybeSingle<{ user_id?: string | null; email?: string | null }>();

    if (profileLookup.error) {
      throw new Error(profileLookup.error.message);
    }

    if (profileLookup.data?.user_id && isUuid(profileLookup.data.user_id)) {
      userId = profileLookup.data.user_id;
    }

    let authUser = userId ? (await supabaseAdmin.auth.admin.getUserById(userId)).data.user ?? null : null;
    if (!authUser) {
      authUser = await findAuthUserByEmail(email);
    }

    if (!authUser) {
      const createUserResult = await supabaseAdmin.auth.admin.createUser({
        email,
        password: strategy === "set_password" ? password : randomBytes(12).toString("base64url"),
        email_confirm: true,
      });

      if (createUserResult.error || !createUserResult.data.user) {
        throw new Error(createUserResult.error?.message ?? "Kullanıcı oluşturulamadı.");
      }

      authUser = createUserResult.data.user;
    } else if (strategy === "set_password") {
      const updateResult = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
      });

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }

      authUser = updateResult.data.user ?? authUser;
    }

    const currentMetadata =
      typeof authUser.user_metadata === "object" && authUser.user_metadata !== null
        ? (authUser.user_metadata as Record<string, unknown>)
        : {};

    const onboardingMetadata: Record<string, unknown> = {
      ...currentMetadata,
      full_name:
        typeof currentMetadata.full_name === "string" && currentMetadata.full_name.trim()
          ? currentMetadata.full_name
          : null,
      legacy_onboarding_required: true,
      legacy_password_set: strategy === "set_password",
      legacy_target_plan: "pro",
      legacy_onboarding_email: email,
      legacy_onboarding_started_at: new Date().toISOString(),
      legacy_stripe_subscription_id: stripeSubscriptionId,
      legacy_stripe_customer_id: stripeCustomerId,
      legacy_stripe_mode: stripeMode,
    };

    const metadataUpdate = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      user_metadata: onboardingMetadata,
      email_confirm: true,
    });

    if (metadataUpdate.error) {
      throw new Error(metadataUpdate.error.message);
    }

    await ensureProfile(authUser.id, email);

    let linkedCount = 0;

    if (stripeSubscriptionId) {
      linkedCount += await updateSubscriptionsByField("stripe_subscription_id", stripeSubscriptionId, authUser.id);
    }

    if (stripeCustomerId) {
      linkedCount += await updateSubscriptionsByField("stripe_customer_id", stripeCustomerId, authUser.id);
    }

    let insertedFallback = false;
    if (!linkedCount && (stripeSubscriptionId || stripeCustomerId)) {
      insertedFallback = await insertFallbackSubscription({
        userId: authUser.id,
        stripeSubscriptionId,
        stripeCustomerId,
        shopId,
        storeId,
        plan,
        status,
        currentPeriodEnd,
      });
    }

    let actionLink: string | null = null;
    let emailDispatched = false;
    let emailDispatchError: string | null = null;
    if (strategy === "magic_link") {
      actionLink = await generateAdminMagicLink(email, appUrl);
      const emailDispatch = await dispatchMagicLinkEmail(email, appUrl);
      emailDispatched = emailDispatch.ok;
      emailDispatchError = emailDispatch.error;
    }

    return NextResponse.json({
      success: true,
      strategy,
      email,
      userId: authUser.id,
      linkedSubscriptions: linkedCount,
      insertedFallback,
      actionLink,
      emailDispatched,
      emailDispatchError,
      onboardedBy: admin.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy kullanıcı onboarding başarısız";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
