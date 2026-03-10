import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import {
  getStripeClientForMode,
  resolveStripeModeForRequest,
  type BillingInterval,
  type BillingPlan,
} from "@/lib/stripe/client";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

export const runtime = "nodejs";

type SubscriptionPayload = {
  mode: "subscription";
  plan: BillingPlan;
  interval?: BillingInterval;
  shopId: string;
};

type OneTimePayload = {
  mode: "payment";
  amount: number;
  shopId: string;
  orderId?: string;
  plan?: BillingPlan;
};

const isSubscriptionPayload = (payload: SubscriptionPayload | OneTimePayload): payload is SubscriptionPayload => {
  return payload.mode === "subscription";
};

export async function POST(request: NextRequest) {
  try {
    const stripeMode = resolveStripeModeForRequest(request);
    const stripe = getStripeClientForMode(stripeMode);
    const body = (await request.json()) as SubscriptionPayload | OneTimePayload;
    const appUrl = resolvePublicSiteUrl(request);

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isSubscriptionPayload(body)) {
      const billingInterval = body.interval === "year" ? "year" : "month";
      const priceId = await resolveCheckoutPriceId(body.plan, billingInterval, {
        mode: stripeMode,
        currency: "usd",
      });

      if (!priceId) {
        return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=sub`,
        cancel_url: `${appUrl}/?cancelled=1`,
        subscription_data: {
          metadata: {
            userId: user.id,
            shopId: body.shopId,
            storeId: body.shopId,
            plan: body.plan,
            billingInterval,
            billingCurrency: "usd",
            stripeMode,
          },
        },
        metadata: {
          userId: user.id,
          shopId: body.shopId,
          storeId: body.shopId,
          plan: body.plan,
          billingInterval,
          billingCurrency: "usd",
          stripeMode,
        },
      });

      return NextResponse.json({ url: session.url });
    }

    if (!body.amount || body.amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${appUrl}/orders?payment=success&type=one_time&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?cancelled=1`,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Shop Activation - ${body.shopId}`,
            },
            unit_amount: Math.round(body.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: user.id,
        shopId: body.shopId,
        orderId: body.orderId ?? null,
        plan: body.plan ?? "standard",
        stripeMode,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
