import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { getStripeClientForMode } from "@/lib/stripe/client";
import { buildExtraStorePaymentShopId, loadUserStoreQuota } from "@/lib/stores/quota";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

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

    const quota = await loadUserStoreQuota(user.id);
    if (!quota.hasActiveSubscription) {
      return NextResponse.json(
        {
          code: "SUBSCRIPTION_REQUIRED",
          error: "Ek mağaza hakkı satın almak için önce aktif bir abonelik gerekli.",
        },
        { status: 409 }
      );
    }

    if (quota.canCreateStore) {
      return NextResponse.json(
        {
          code: "LIMIT_NOT_REACHED",
          error: "Mağaza limitiniz dolmadan ek mağaza hakkı satın alamazsınız.",
          quota,
        },
        { status: 409 }
      );
    }

    const appUrl = resolvePublicSiteUrl(request);
    const stripe = getStripeClientForMode();
    const amountCents = quota.extraStorePriceCents;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${appUrl}/?store_capacity=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?store_capacity=cancelled`,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Listflow Extra Store Slot",
              description: `1 additional store slot for ${quota.plan.toUpperCase()} plan`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: user.id,
        shopId: buildExtraStorePaymentShopId(quota.plan),
        plan: quota.plan,
        purpose: "store_capacity_topup",
        creditCount: "1",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store capacity checkout could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
