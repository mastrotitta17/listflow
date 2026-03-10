import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import {
  buildSubscriptionStoreIdResolver,
  filterSubscriptionsForStore,
  loadUserSubscriptions,
  summarizeStoreSubscriptions,
} from "@/lib/settings/subscriptions";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  store_name: string;
  user_id: string;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

export async function GET(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [storesResult, subscriptions] = await Promise.all([
      supabaseAdmin
        .from("stores")
        .select("id, store_name, user_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      loadUserSubscriptions(user.id),
    ]);

    if (storesResult.error) {
      throw new Error(storesResult.error.message);
    }

    const stores = (storesResult.data ?? []) as StoreRow[];
    const resolveStoreId = buildSubscriptionStoreIdResolver(
      stores.map((store) => ({
        id: store.id,
        user_id: store.user_id,
        store_name: store.store_name,
      }))
    );
    const expiredStores = stores
      .map((store) => {
        const summary = summarizeStoreSubscriptions(
          filterSubscriptionsForStore(subscriptions, store.id, { resolveStoreId })
        );
        if (summary.renewalState !== "renewal_required") {
          return null;
        }

        return {
          id: store.id,
          name: store.store_name,
          plan: summary.lastSubscriptionPlan,
          currentPeriodEnd: summary.currentPeriodEnd,
          renewalState: summary.renewalState,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return NextResponse.json(
      {
        expiredStoreCount: expiredStores.length,
        expiredStores,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription summary could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
