import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { isAdminResource, ADMIN_RESOURCE_MAP } from "@/lib/admin/resources";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { supabaseAdmin } from "@/lib/supabase/admin";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });
const isMissingTableError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isNotFoundError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("not found") || message.includes("no rows found");
};

const safeDeleteByUser = async (table: string, userId: string, userColumn = "user_id") => {
  const result = await supabaseAdmin.from(table).delete().eq(userColumn, userId);

  if (result.error && !isMissingTableError(result.error)) {
    throw new Error(result.error.message);
  }
};

const findAuthUsersByEmail = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const matches: Array<{ id: string; email: string | null }> = [];

  for (let page = 1; page <= 50; page += 1) {
    const listed = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (listed.error) {
      throw new Error(listed.error.message);
    }

    const users = listed.data?.users ?? [];
    for (const user of users) {
      if ((user.email ?? "").toLowerCase() === normalized) {
        matches.push({ id: user.id, email: user.email ?? null });
      }
    }

    if (users.length < 200) {
      break;
    }
  }

  return matches;
};

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

const normalizeStoreCurrency = (value: unknown): "USD" | "TRY" | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "TRY" || normalized === "TL") {
    return "TRY";
  }
  if (normalized === "USD" || normalized === "$") {
    return "USD";
  }
  return null;
};

const normalizeSubscriptionPlan = (value: unknown): "standard" | "pro" | "turbo" | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "starter" || normalized === "standard") {
    return "standard";
  }
  if (normalized === "pro") {
    return "pro";
  }
  if (normalized === "turbo") {
    return "turbo";
  }
  return null;
};

type StoreRow = Record<string, unknown>;
type SubscriptionPlanRow = {
  id: string;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const updateStoreWithFallback = async (storeId: string, patch: Record<string, unknown>) => {
  let candidatePatch = { ...patch };
  const optionalKeys = ["store_name", "store_currency", "currency", "updated_at"];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabaseAdmin
      .from("stores")
      .update(candidatePatch)
      .eq("id", storeId)
      .select("*")
      .maybeSingle<StoreRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    if (isMissingTableError(result.error)) {
      throw new Error("Table stores does not exist in remote schema.");
    }

    const removable = optionalKeys.find(
      (key) => Object.prototype.hasOwnProperty.call(candidatePatch, key) && isMissingColumnError(result.error, key)
    );

    if (removable) {
      delete candidatePatch[removable];
      if (Object.keys(candidatePatch).length === 0) {
        const storeLoad = await supabaseAdmin.from("stores").select("*").eq("id", storeId).maybeSingle<StoreRow>();
        if (storeLoad.error) {
          throw new Error(storeLoad.error.message || "Store could not be loaded");
        }
        return storeLoad.data ?? null;
      }
      continue;
    }

    throw new Error(result.error.message || "Store could not be updated");
  }

  throw new Error("Store update failed after multiple schema fallbacks");
};

const loadStoreSubscriptionCandidates = async (storeId: string) => {
  const results = new Map<string, SubscriptionPlanRow>();
  const selectCandidates = [
    "id,status,updated_at,created_at,store_id,shop_id",
    "id,status,updated_at,created_at,store_id",
    "id,status,updated_at,created_at,shop_id",
    "id,status,created_at,store_id,shop_id",
    "id,status,created_at,store_id",
    "id,status,created_at,shop_id",
  ];

  const collectByColumn = async (column: "store_id" | "shop_id") => {
    let lastError: { message?: string; code?: string } | null = null;
    for (const select of selectCandidates) {
      if (!select.includes(column)) {
        continue;
      }

      const query = await supabaseAdmin
        .from("subscriptions")
        .select(select)
        .eq(column, storeId)
        .limit(200);

      if (!query.error) {
        for (const row of ((query.data ?? []) as unknown as SubscriptionPlanRow[])) {
          results.set(row.id, row);
        }
        return;
      }

      lastError = query.error;
      if (!isMissingColumnError(query.error, column) && !isMissingColumnError(query.error, "updated_at")) {
        throw new Error(query.error.message || "Subscriptions could not be loaded");
      }
    }

    if (lastError && !isMissingColumnError(lastError, column)) {
      throw new Error(lastError.message || "Subscriptions could not be loaded");
    }
  };

  await collectByColumn("store_id");
  await collectByColumn("shop_id");
  return Array.from(results.values());
};

const pickSubscriptionForPlanUpdate = (rows: SubscriptionPlanRow[]) => {
  if (!rows.length) {
    return null;
  }

  const priority = (status: string | null | undefined) => {
    const normalized = (status ?? "").toLowerCase();
    if (normalized === "active" || normalized === "trialing") return 3;
    if (normalized === "past_due" || normalized === "incomplete") return 2;
    if (normalized === "canceled") return 0;
    return 1;
  };

  const sorted = [...rows].sort((left, right) => {
    const byPriority = priority(right.status) - priority(left.status);
    if (byPriority !== 0) return byPriority;

    const byUpdated = toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    if (byUpdated !== 0) return byUpdated;

    const byCreated = toTimestamp(right.created_at) - toTimestamp(left.created_at);
    if (byCreated !== 0) return byCreated;

    return right.id.localeCompare(left.id);
  });

  return sorted[0] ?? null;
};

const updateSubscriptionPlanWithFallback = async (subscriptionId: string, plan: "standard" | "pro" | "turbo") => {
  const nowIso = new Date().toISOString();
  const withTimestamp = await supabaseAdmin
    .from("subscriptions")
    .update({ plan, updated_at: nowIso })
    .eq("id", subscriptionId)
    .select("id,plan,status,store_id,shop_id,updated_at")
    .maybeSingle();

  if (!withTimestamp.error) {
    return withTimestamp.data ?? null;
  }

  if (isMissingColumnError(withTimestamp.error, "updated_at")) {
    const fallback = await supabaseAdmin
      .from("subscriptions")
      .update({ plan })
      .eq("id", subscriptionId)
      .select("id,plan,status,store_id,shop_id")
      .maybeSingle();

    if (!fallback.error) {
      return fallback.data ?? null;
    }

    throw new Error(fallback.error.message || "Subscription plan could not be updated");
  }

  throw new Error(withTimestamp.error.message || "Subscription plan could not be updated");
};

const patchStoreResource = async (id: string, body: Record<string, unknown>) => {
  const hasStoreNameField = Object.prototype.hasOwnProperty.call(body, "store_name");
  const hasCurrencyField =
    Object.prototype.hasOwnProperty.call(body, "store_currency") || Object.prototype.hasOwnProperty.call(body, "currency");
  const hasPlanField =
    Object.prototype.hasOwnProperty.call(body, "plan") || Object.prototype.hasOwnProperty.call(body, "subscription_plan");

  const requestedStoreName = typeof body.store_name === "string" ? normalizeStoreNameInput(body.store_name) : null;
  const requestedCurrency = normalizeStoreCurrency(body.store_currency ?? body.currency);
  const requestedPlan = normalizeSubscriptionPlan(body.plan ?? body.subscription_plan);

  if (hasStoreNameField && !requestedStoreName) {
    throw new Error("Geçersiz mağaza adı.");
  }

  if (hasCurrencyField && !requestedCurrency) {
    throw new Error("Geçersiz mağaza para birimi. Sadece USD veya TRY kullanılabilir.");
  }

  if (hasPlanField && !requestedPlan) {
    throw new Error("Geçersiz abonelik planı. Sadece standard, pro veya turbo kullanılabilir.");
  }

  if (!requestedStoreName && !requestedCurrency && !requestedPlan) {
    throw new Error("Geçerli güncelleme alanı yok (store_name, store_currency, plan).");
  }

  const storePatch: Record<string, unknown> = {};
  if (requestedStoreName) {
    storePatch.store_name = requestedStoreName;
  }
  if (requestedCurrency) {
    storePatch.store_currency = requestedCurrency;
    storePatch.currency = requestedCurrency.toLowerCase();
  }
  if (Object.keys(storePatch).length > 0) {
    storePatch.updated_at = new Date().toISOString();
  }

  const updatedStore =
    Object.keys(storePatch).length > 0
      ? await updateStoreWithFallback(id, storePatch)
      : await supabaseAdmin.from("stores").select("*").eq("id", id).maybeSingle<StoreRow>().then((result) => {
          if (result.error) {
            throw new Error(result.error.message || "Store could not be loaded");
          }
          return result.data ?? null;
        });

  if (!updatedStore) {
    throw new Error("Store not found.");
  }

  let updatedSubscription: Record<string, unknown> | null = null;
  if (requestedPlan) {
    const candidates = await loadStoreSubscriptionCandidates(id);
    const targetSubscription = pickSubscriptionForPlanUpdate(candidates);

    if (!targetSubscription) {
      throw new Error("Bu mağaza için güncellenecek subscription kaydı bulunamadı.");
    }

    updatedSubscription = await updateSubscriptionPlanWithFallback(targetSubscription.id, requestedPlan);
  }

  return {
    row: updatedStore,
    subscription: updatedSubscription,
  };
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];
  const body = (await request.json()) as Record<string, unknown>;

  if (resource === "stores") {
    try {
      const patched = await patchStoreResource(id, body);
      return NextResponse.json(patched);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Store could not be updated";
      const statusCode = message.toLowerCase().includes("not found") ? 404 : 400;
      return NextResponse.json({ error: message }, { status: statusCode });
    }
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .update(body)
    .eq(idColumn, id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ row: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  if (resource === "users") {
    try {
      const profileLookup = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("user_id", id)
        .maybeSingle<{ email?: string | null }>();

      const profileEmail =
        !profileLookup.error && typeof profileLookup.data?.email === "string"
          ? profileLookup.data.email.trim().toLowerCase()
          : null;

      await safeDeleteByUser("orders", id);
      await safeDeleteByUser("scheduler_jobs", id);
      await safeDeleteByUser("payments", id);
      await safeDeleteByUser("subscriptions", id);
      await safeDeleteByUser("stores", id);
      await safeDeleteByUser("referral_codes", id);
      await safeDeleteByUser("referral_rewards", id);
      await safeDeleteByUser("referral_conversions", id, "referrer_user_id");
      await safeDeleteByUser("referral_conversions", id, "referred_user_id");
      await safeDeleteByUser("profiles", id);

      const authDelete = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authDelete.error && !isNotFoundError(authDelete.error)) {
        return NextResponse.json({ error: authDelete.error.message }, { status: 500 });
      }

      if (profileEmail) {
        const relatedAuthUsers = await findAuthUsersByEmail(profileEmail);
        for (const authUser of relatedAuthUsers) {
          if (!authUser?.id) {
            continue;
          }
          const cleanup = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
          if (cleanup.error && !isNotFoundError(cleanup.error)) {
            return NextResponse.json({ error: cleanup.error.message }, { status: 500 });
          }
        }
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "User could not be deleted";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];

  const { error } = await supabaseAdmin.from(table).delete().eq(idColumn, id);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
