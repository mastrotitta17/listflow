import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getActiveStripeMode, getStripeClientForMode } from "@/lib/stripe/client";
import { isSubscriptionActive, loadUserSubscriptions } from "@/lib/settings/subscriptions";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const loadProfileStripeCustomerId = async (userId: string) => {
  const withCustomer = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle<{ stripe_customer_id?: string | null }>();

  if (!withCustomer.error) {
    return withCustomer.data?.stripe_customer_id ?? null;
  }

  if (isMissingColumnError(withCustomer.error, "stripe_customer_id")) {
    return null;
  }

  throw new Error(withCustomer.error.message);
};

const resolveCustomerFromStripeSubscription = async (
  subscriptionId: string | null | undefined,
  activeMode: ReturnType<typeof getActiveStripeMode>
) => {
  if (!subscriptionId) {
    return null;
  }

  try {
    const subscription = await getStripeClientForMode(activeMode).subscriptions.retrieve(subscriptionId);
    return typeof subscription.customer === "string" ? subscription.customer : null;
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    const appUrl = resolvePublicSiteUrl(request);
    const activeMode = getActiveStripeMode();
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscriptions = await loadUserSubscriptions(user.id);
    const activeSubscriptions = subscriptions.filter((row) => isSubscriptionActive(row));

    if (!activeSubscriptions.length) {
      return NextResponse.json(
        { error: "Aktif abonelik bulunamadı. Stripe yönetim sayfası açılamadı." },
        { status: 409 }
      );
    }

    const candidateCustomerIds = new Set<string>();

    for (const row of activeSubscriptions) {
      if (row.stripe_customer_id) {
        candidateCustomerIds.add(row.stripe_customer_id);
      }
    }

    for (const row of activeSubscriptions) {
      const resolved = await resolveCustomerFromStripeSubscription(row.stripe_subscription_id ?? null, activeMode);
      if (resolved) {
        candidateCustomerIds.add(resolved);
      }
    }

    const customerFromProfile = await loadProfileStripeCustomerId(user.id);
    if (customerFromProfile) {
      candidateCustomerIds.add(customerFromProfile);
    }

    if (!candidateCustomerIds.size) {
      return NextResponse.json(
        {
          code: "STRIPE_CUSTOMER_NOT_FOUND_IN_ACTIVE_MODE",
          error: "Stripe müşteri kaydı aktif ödeme modunda bulunamadı.",
          activeMode,
        },
        { status: 409 }
      );
    }

    let lastError: string | null = null;
    let missingCustomerInActiveMode = false;

    for (const customerId of candidateCustomerIds) {
      try {
        const session = await getStripeClientForMode(activeMode).billingPortal.sessions.create({
          customer: customerId,
          return_url: `${appUrl}/`,
        });

        return NextResponse.json({ url: session.url });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Stripe müşteri portalı açılamadı";
        if ((lastError ?? "").toLowerCase().includes("no such customer")) {
          missingCustomerInActiveMode = true;
        }
      }
    }

    if (missingCustomerInActiveMode) {
      return NextResponse.json(
        {
          code: "STRIPE_CUSTOMER_NOT_FOUND_IN_ACTIVE_MODE",
          error: `Stripe müşteri kaydı aktif modda (${activeMode}) bulunamadı.`,
          activeMode,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: lastError ?? "Stripe müşteri portalı açılamadı. Lütfen daha sonra tekrar deneyin." },
      { status: 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe müşteri portalı açılamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
