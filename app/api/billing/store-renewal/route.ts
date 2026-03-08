import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import {
  filterSubscriptionsForStore,
  loadUserSubscriptions,
  resolveStripeBillingIntervalForSubscription,
  summarizeStoreSubscriptions,
} from "@/lib/settings/subscriptions";
import { getStripeClientForMode, resolveStripeModeForRequest } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

export const runtime = "nodejs";

type RenewalBody = {
  storeId?: unknown;
};

type StoreRow = {
  id: string;
  user_id: string;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RenewalBody;
    const storeId = toTrimmed(body.storeId);
    if (!storeId) {
      return NextResponse.json({ error: "storeId is required" }, { status: 400 });
    }

    const storeResult = await supabaseAdmin
      .from("stores")
      .select("id, user_id")
      .eq("id", storeId)
      .eq("user_id", user.id)
      .maybeSingle<StoreRow>();

    if (storeResult.error) {
      throw new Error(storeResult.error.message);
    }

    if (!storeResult.data) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const subscriptions = await loadUserSubscriptions(user.id);
    const matched = filterSubscriptionsForStore(subscriptions, storeId);
    const snapshot = summarizeStoreSubscriptions(matched);

    if (snapshot.renewalState === "activation_required") {
      return NextResponse.json(
        { error: "Store has no previous subscription history. Use activation checkout instead." },
        { status: 409 }
      );
    }

    if (snapshot.renewalState === "active") {
      return NextResponse.json(
        { error: "Store already has an active subscription." },
        { status: 409 }
      );
    }

    const plan = snapshot.lastSubscriptionPlan;
    if (!plan) {
      return NextResponse.json({ error: "Previous subscription plan could not be resolved." }, { status: 409 });
    }

    const latestSubscription = snapshot.latestSubscription;
    const billingInterval =
      (latestSubscription ? await resolveStripeBillingIntervalForSubscription(latestSubscription) : null) ?? "month";

    const stripeMode = resolveStripeModeForRequest(request);
    const priceId = await resolveCheckoutPriceId(plan, billingInterval, { mode: stripeMode });
    if (!priceId) {
      return NextResponse.json({ error: "Renewal price could not be resolved." }, { status: 400 });
    }

    const stripe = getStripeClientForMode(stripeMode);
    const appUrl = resolvePublicSiteUrl(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=sub&renewal=1`,
      cancel_url: `${appUrl}/etsy-automation?cancelled=1`,
      subscription_data: {
        metadata: {
          userId: user.id,
          shopId: storeId,
          storeId,
          plan,
          billingInterval,
          renewal: "true",
          stripeMode,
        },
      },
      metadata: {
        userId: user.id,
        shopId: storeId,
        storeId,
        plan,
        billingInterval,
        renewal: "true",
        stripeMode,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store renewal checkout could not be started";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
