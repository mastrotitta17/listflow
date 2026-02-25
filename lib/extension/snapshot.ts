import { isSubscriptionActive, loadUserSubscriptions } from "@/lib/settings/subscriptions";
import { supabaseAdmin } from "@/lib/supabase/admin";

type QueryError = {
  message?: string | null;
  code?: string | null;
};

type ProfileRow = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
};

type StoreRow = {
  id: string;
  store_name?: string | null;
  category?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type OrderRow = {
  id: string;
  store_id?: string | null;
  category_name?: string | null;
  sub_product_name?: string | null;
  variant_name?: string | null;
  payment_status?: string | null;
  order_date?: string | null;
  created_at?: string | null;
};

export type ExtensionStoreSnapshot = {
  store_id: string;
  store_name: string;
  category: string | null;
  status: string | null;
  paid_order_count: number;
  created_at: string | null;
};

export type ExtensionOrderSnapshot = {
  order_id: string;
  store_id: string | null;
  store_name: string | null;
  category_name: string | null;
  sub_product_name: string | null;
  variant_name: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  created_at: string | null;
  shipping: {
    tracking_number: string | null;
  } | null;
};

export type ExtensionStateSnapshot = {
  linked: true;
  linked_user: {
    user_id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
    client_id: string | null;
  };
  subscription: {
    status: string;
    plan: string | null;
    current_period_end: string | null;
    is_active: boolean;
  };
  stores: ExtensionStoreSnapshot[];
  orders: ExtensionOrderSnapshot[];
  last_sync_at: string;
};

const isMissingColumnError = (error: QueryError | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isMissingTableError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || message.includes("relation") || message.includes("does not exist");
};

const isRecoverableError = (error: QueryError | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  if (isMissingTableError(error)) {
    return true;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const toIso = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const loadProfile = async (userId: string): Promise<ProfileRow | null> => {
  const candidates = [
    "user_id,email,full_name,role",
    "user_id,email,full_name",
    "user_id,email,role",
    "user_id,email",
    "user_id,full_name,role",
    "user_id,full_name",
    "user_id,role",
    "user_id",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of candidates) {
    const result = await supabaseAdmin.from("profiles").select(select).eq("user_id", userId).maybeSingle<ProfileRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    lastError = result.error;

    if (!isRecoverableError(result.error, ["email", "full_name", "role"])) {
      throw new Error(result.error.message ?? "Profile could not be loaded");
    }
  }

  if (isMissingTableError(lastError)) {
    return null;
  }

  return null;
};

const loadStores = async (userId: string): Promise<StoreRow[]> => {
  const candidates = [
    "id,store_name,category,status,created_at",
    "id,store_name,category,status",
    "id,store_name,category",
    "id,store_name",
    "id",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of candidates) {
    const result = await supabaseAdmin
      .from("stores")
      .select(select as string)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (!result.error) {
      return ((result.data ?? []) as unknown as StoreRow[]) ?? [];
    }

    lastError = result.error;

    if (!isRecoverableError(result.error, ["store_name", "category", "status", "created_at"])) {
      throw new Error(result.error.message ?? "Stores could not be loaded");
    }
  }

  if (isMissingTableError(lastError)) {
    return [];
  }

  return [];
};

const loadOrders = async (
  userId: string
): Promise<{
  rows: OrderRow[];
  hasPaymentStatus: boolean;
}> => {
  const candidates = [
    {
      select: "id,store_id,category_name,sub_product_name,variant_name,payment_status,order_date,created_at",
      hasPaymentStatus: true,
    },
    {
      select: "id,store_id,category_name,sub_product_name,variant_name,payment_status,created_at",
      hasPaymentStatus: true,
    },
    {
      select: "id,store_id,category_name,sub_product_name,variant_name,order_date,created_at",
      hasPaymentStatus: false,
    },
    {
      select: "id,store_id,category_name,sub_product_name,variant_name,created_at",
      hasPaymentStatus: false,
    },
    {
      select: "id,store_id,category_name,sub_product_name,created_at",
      hasPaymentStatus: false,
    },
    {
      select: "id,store_id,created_at",
      hasPaymentStatus: false,
    },
    {
      select: "id,created_at",
      hasPaymentStatus: false,
    },
  ] as const;

  let lastError: QueryError | null = null;

  for (const candidate of candidates) {
    const result = await supabaseAdmin
      .from("orders")
      .select(candidate.select as string)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!result.error) {
      return {
        rows: ((result.data ?? []) as unknown as OrderRow[]) ?? [],
        hasPaymentStatus: candidate.hasPaymentStatus,
      };
    }

    lastError = result.error;

    if (
      !isRecoverableError(result.error, [
        "store_id",
        "category_name",
        "sub_product_name",
        "variant_name",
        "payment_status",
        "order_date",
        "created_at",
      ])
    ) {
      throw new Error(result.error.message ?? "Orders could not be loaded");
    }
  }

  if (isMissingTableError(lastError)) {
    return { rows: [], hasPaymentStatus: false };
  }

  return { rows: [], hasPaymentStatus: false };
};

const resolveFullName = (profile: ProfileRow | null, email: string | null) => {
  const profileName = profile?.full_name?.trim();
  if (profileName) {
    return profileName;
  }

  if (email && email.includes("@")) {
    const [namePart] = email.split("@");
    return namePart || null;
  }

  return null;
};

export const buildExtensionStateSnapshot = async (args: {
  userId: string;
  email: string | null;
}): Promise<ExtensionStateSnapshot> => {
  const [profile, stores, orderResult, subscriptions] = await Promise.all([
    loadProfile(args.userId),
    loadStores(args.userId),
    loadOrders(args.userId),
    loadUserSubscriptions(args.userId),
  ]);

  const activeSubscription = subscriptions.find((row) => isSubscriptionActive(row)) ?? null;
  const latestSubscription =
    activeSubscription ??
    subscriptions
      .slice()
      .sort((a, b) => {
        const aTs = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        const bTs = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
        return bTs - aTs;
      })[0] ??
    null;

  const storeNameById = new Map<string, string>();
  const paidOrderCountByStoreId = new Map<string, number>();

  for (const store of stores) {
    storeNameById.set(store.id, store.store_name?.trim() || store.id);
    paidOrderCountByStoreId.set(store.id, 0);
  }

  for (const row of orderResult.rows) {
    const storeId = row.store_id ?? null;
    if (!storeId) {
      continue;
    }

    if (!paidOrderCountByStoreId.has(storeId)) {
      continue;
    }

    const paymentStatus = (row.payment_status ?? "").toLowerCase();
    const shouldCount = orderResult.hasPaymentStatus ? paymentStatus === "paid" : true;
    if (!shouldCount) {
      continue;
    }

    paidOrderCountByStoreId.set(storeId, (paidOrderCountByStoreId.get(storeId) ?? 0) + 1);
  }

  const mappedStores: ExtensionStoreSnapshot[] = stores.map((store) => ({
    store_id: store.id,
    store_name: store.store_name?.trim() || store.id,
    category: store.category ?? null,
    status: store.status ?? null,
    paid_order_count: paidOrderCountByStoreId.get(store.id) ?? 0,
    created_at: toIso(store.created_at),
  }));

  const mappedOrders: ExtensionOrderSnapshot[] = orderResult.rows.map((row) => {
    const paymentStatus = row.payment_status ? row.payment_status.toLowerCase() : null;
    const fulfillmentStatus =
      paymentStatus === "paid" ? "paid" : paymentStatus === "pending" ? "pending" : paymentStatus;

    return {
      order_id: row.id,
      store_id: row.store_id ?? null,
      store_name: row.store_id ? storeNameById.get(row.store_id) ?? null : null,
      category_name: row.category_name ?? null,
      sub_product_name: row.sub_product_name ?? null,
      variant_name: row.variant_name ?? null,
      payment_status: paymentStatus,
      fulfillment_status: fulfillmentStatus,
      created_at: toIso(row.created_at ?? row.order_date),
      shipping: {
        tracking_number: null,
      },
    };
  });

  return {
    linked: true,
    linked_user: {
      user_id: args.userId,
      email: profile?.email ?? args.email ?? null,
      full_name: resolveFullName(profile, profile?.email ?? args.email ?? null),
      role: profile?.role ?? null,
      client_id: null,
    },
    subscription: {
      status: latestSubscription?.status ?? "inactive",
      plan: latestSubscription?.plan ?? null,
      current_period_end: toIso(latestSubscription?.current_period_end),
      is_active: Boolean(activeSubscription),
    },
    stores: mappedStores,
    orders: mappedOrders,
    last_sync_at: new Date().toISOString(),
  };
};
