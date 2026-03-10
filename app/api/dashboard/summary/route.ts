import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import {
  filterSubscriptionsForStore,
  isSubscriptionActive,
  loadUserSubscriptions,
  summarizeStoreSubscriptions,
  type SettingsSubscriptionRow,
} from "@/lib/settings/subscriptions";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url?: string | null;
  phone?: string | null;
};

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  active_webhook_config_id?: string | null;
};

const PLAN_PRIORITY = ["turbo", "pro", "standard"] as const;

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const loadProfile = async (userId: string) => {
  const selectCandidates = [
    "user_id,email,full_name,avatar_url,phone",
    "user_id,email,full_name,avatar_url",
    "user_id,email,full_name,phone",
    "user_id,email,full_name",
  ] as const;

  for (const select of selectCandidates) {
    const result = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    if (!isMissingColumnError(result.error, "phone") && !isMissingColumnError(result.error, "avatar_url")) {
      throw new Error(result.error.message);
    }
  }

  return null;
};

const loadStores = async (userId: string) => {
  const selectCandidates = [
    "id,user_id,store_name,active_webhook_config_id",
    "id,user_id,store_name",
  ] as const;

  for (const select of selectCandidates) {
    const result = await supabaseAdmin
      .from("stores")
      .select(select)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!result.error) {
      return (((result.data ?? []) as unknown) as StoreRow[]).map((store) => ({
        ...store,
        active_webhook_config_id: "active_webhook_config_id" in store ? store.active_webhook_config_id ?? null : null,
      }));
    }

    if (!isMissingColumnError(result.error, "active_webhook_config_id")) {
      throw new Error(result.error.message);
    }
  }

  return [] as StoreRow[];
};

const countListings = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return {
      totalProductsCount: 0,
      readyProductsCount: 0,
      failedProductsCount: 0,
    };
  }

  const [totalResult, readyResult, failedResult] = await Promise.all([
    supabaseAdmin
      .from("listing")
      .select("id", { count: "exact", head: true })
      .in("client_id", storeIds),
    supabaseAdmin
      .from("listing")
      .select("id", { count: "exact", head: true })
      .in("client_id", storeIds)
      .eq("status", "pending"),
    supabaseAdmin
      .from("listing")
      .select("id", { count: "exact", head: true })
      .in("client_id", storeIds)
      .eq("status", "failed"),
  ]);

  for (const result of [totalResult, readyResult, failedResult]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  return {
    totalProductsCount: totalResult.count ?? 0,
    readyProductsCount: readyResult.count ?? 0,
    failedProductsCount: failedResult.count ?? 0,
  };
};

const countOrders = async (userId: string) => {
  const [totalResult, paidResult] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("payment_status", "paid"),
  ]);

  for (const result of [totalResult, paidResult]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  return {
    totalOrdersCount: totalResult.count ?? 0,
    paidOrdersCount: paidResult.count ?? 0,
  };
};

const resolvePlanSummary = (rows: SettingsSubscriptionRow[]) => {
  const activeRows = rows.filter((row) => isSubscriptionActive(row));

  for (const plan of PLAN_PRIORITY) {
    const row = activeRows.find((item) => (item.plan ?? "").toLowerCase() === plan);
    if (row) {
      return {
        plan: row.plan ?? null,
        status: row.status ?? null,
      };
    }
  }

  const latest = rows[0] ?? null;
  return {
    plan: latest?.plan ?? null,
    status: latest?.status ?? null,
  };
};

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

    const [profile, stores, subscriptions, ordersCount] = await Promise.all([
      loadProfile(user.id),
      loadStores(user.id),
      loadUserSubscriptions(user.id),
      countOrders(user.id),
    ]);
    const listingCount = await countListings(stores.map((row) => row.id));

    const profileFullName = profile?.full_name?.trim() || null;
    const profilePhone = profile?.phone?.trim() || null;
    const storesWithState = stores.map((store) => {
      const snapshot = summarizeStoreSubscriptions(filterSubscriptionsForStore(subscriptions, store.id));
      return {
        id: store.id,
        name: store.store_name,
        renewalState: snapshot.renewalState,
        hasAutomation: Boolean(store.active_webhook_config_id),
      };
    });

    const activeStoreCount = storesWithState.filter((store) => store.renewalState === "active").length;
    const renewalRequiredCount = storesWithState.filter((store) => store.renewalState === "renewal_required").length;
    const activationRequiredCount = storesWithState.filter((store) => store.renewalState === "activation_required").length;
    const automationEnabledCount = storesWithState.filter((store) => store.hasAutomation).length;

    return NextResponse.json(
      {
        userId: user.id,
        profile: {
          fullName: profileFullName,
          email: profile?.email ?? user.email ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          phone: profilePhone,
          isComplete: Boolean(profileFullName && profilePhone),
        },
        plan: resolvePlanSummary(subscriptions),
        stats: {
          storeCount: stores.length,
          activeStoreCount,
          renewalRequiredCount,
          activationRequiredCount,
          automationEnabledCount,
          ...listingCount,
          ...ordersCount,
        },
        stores: storesWithState,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard summary could not be loaded.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
