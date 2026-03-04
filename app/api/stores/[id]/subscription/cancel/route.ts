import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  cancelStripeSubscriptionsNow,
  isSubscriptionActive,
  loadUserSubscriptions,
  resolveStoreIdFromSubscription,
  type SettingsSubscriptionRow,
} from "@/lib/settings/subscriptions";
import { syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";

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

const updateSubscriptionAsCanceled = async (row: SettingsSubscriptionRow, userId: string, nowIso: string) => {
  const primary = await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      current_period_end: nowIso,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("user_id", userId);

  if (!primary.error) {
    return;
  }

  if (!isMissingColumnError(primary.error, "updated_at")) {
    throw new Error(primary.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      current_period_end: nowIso,
    })
    .eq("id", row.id)
    .eq("user_id", userId);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }
};

const updateStoreAsCanceled = async (storeId: string, userId: string, nowIso: string) => {
  const primary = await supabaseAdmin
    .from("stores")
    .update({
      status: "canceled",
      updated_at: nowIso,
    })
    .eq("id", storeId)
    .eq("user_id", userId);

  if (!primary.error) {
    return;
  }

  if (!isMissingColumnError(primary.error, "updated_at")) {
    throw new Error(primary.error.message);
  }

  const fallback = await supabaseAdmin
    .from("stores")
    .update({
      status: "canceled",
    })
    .eq("id", storeId)
    .eq("user_id", userId);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: storeId } = await params;

    const storeQuery = await supabaseAdmin
      .from("stores")
      .select("id, user_id")
      .eq("id", storeId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; user_id: string }>();

    if (storeQuery.error) {
      return NextResponse.json({ error: storeQuery.error.message }, { status: 500 });
    }

    if (!storeQuery.data) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const allSubscriptions = await loadUserSubscriptions(user.id);
    const activeStoreSubscriptions = allSubscriptions.filter((row) => {
      return resolveStoreIdFromSubscription(row) === storeId && isSubscriptionActive(row);
    });

    if (activeStoreSubscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        canceledCount: 0,
        alreadyStopped: true,
      });
    }

    const cancellation = await cancelStripeSubscriptionsNow(activeStoreSubscriptions);

    if (cancellation.missingStripeIds.length > 0) {
      return NextResponse.json(
        {
          error: "Some active subscriptions are missing Stripe subscription IDs.",
          missingStripeIds: cancellation.missingStripeIds,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const canceledRows = activeStoreSubscriptions.filter((row) => cancellation.canceledIds.includes(row.id));

    for (const row of canceledRows) {
      await updateSubscriptionAsCanceled(row, user.id, nowIso);
    }

    const refreshedSubscriptions = await loadUserSubscriptions(user.id);
    const hasActiveSubscription = refreshedSubscriptions.some((row) => {
      return resolveStoreIdFromSubscription(row) === storeId && isSubscriptionActive(row);
    });

    if (!hasActiveSubscription) {
      await updateStoreAsCanceled(storeId, user.id, nowIso);
    }

    await syncProfileSubscriptionState({
      userId: user.id,
      email: user.email ?? null,
      status: hasActiveSubscription ? "active" : "canceled",
      plan: null,
    });

    if (cancellation.failed.length > 0 && hasActiveSubscription) {
      return NextResponse.json(
        {
          success: false,
          error: "Some store subscriptions could not be canceled in Stripe.",
          canceledCount: cancellation.canceledIds.length,
          failed: cancellation.failed,
          hasActiveSubscription,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      canceledCount: cancellation.canceledIds.length,
      failed: cancellation.failed,
      hasActiveSubscription,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store subscription could not be canceled";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
