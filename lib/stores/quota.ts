import { PLAN_TO_MONTHLY_CENTS, type BillingPlan } from "@/lib/stripe/client";
import { isSubscriptionActive, loadUserSubscriptions } from "@/lib/settings/subscriptions";
import { supabaseAdmin } from "@/lib/supabase/admin";

type QueryError = {
  message?: string;
  code?: string | null;
};

export type StoreUpgradeOption = {
  plan: BillingPlan;
  includedStores: number;
  monthlyPriceCents: number;
};

export type UserStoreQuota = {
  plan: BillingPlan;
  hasActiveSubscription: boolean;
  includedStoreLimit: number;
  totalStores: number;
  purchasedExtraStores: number;
  usedExtraStores: number;
  remainingSlots: number;
  canCreateStore: boolean;
  extraStorePriceCents: number;
  upgradeOptions: StoreUpgradeOption[];
};

export const STORE_LIMITS_BY_PLAN: Record<BillingPlan, number> = {
  standard: 4,
  pro: 6,
  turbo: 8,
};

export const EXTRA_STORE_PRICE_CENTS_BY_PLAN: Record<BillingPlan, number> = {
  standard: 2000,
  pro: 2000,
  turbo: 1000,
};

const PLAN_ORDER: BillingPlan[] = ["standard", "pro", "turbo"];
const PLAN_RANK: Record<BillingPlan, number> = {
  standard: 1,
  pro: 2,
  turbo: 3,
};

const EXTRA_STORE_PAYMENT_PREFIX = "extra_store_credit:";

const isMissingColumnError = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isRecoverableColumnError = (error: QueryError | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const normalizePlan = (value: string | null | undefined): BillingPlan | null => {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "standard" || normalized === "starter") return "standard";
  if (normalized === "pro") return "pro";
  if (normalized === "turbo") return "turbo";
  return null;
};

const resolveEffectivePlan = async (userId: string) => {
  const subscriptions = await loadUserSubscriptions(userId);
  const activeRows = subscriptions.filter((row) => isSubscriptionActive(row));

  if (!activeRows.length) {
    const fallbackPlan = normalizePlan(subscriptions[0]?.plan) ?? "standard";
    return {
      plan: fallbackPlan,
      hasActiveSubscription: false,
    };
  }

  const sorted = [...activeRows].sort((a, b) => {
    const planA = normalizePlan(a.plan) ?? "standard";
    const planB = normalizePlan(b.plan) ?? "standard";
    const rankDiff = PLAN_RANK[planB] - PLAN_RANK[planA];
    if (rankDiff !== 0) {
      return rankDiff;
    }

    const aTs = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
    const bTs = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
    return bTs - aTs;
  });

  return {
    plan: normalizePlan(sorted[0]?.plan) ?? "standard",
    hasActiveSubscription: true,
  };
};

const countUserStores = async (userId: string) => {
  const { data, error } = await supabaseAdmin.from("stores").select("id").eq("user_id", userId);

  if (error) {
    throw new Error(error.message ?? "Could not count stores");
  }

  return data?.length ?? 0;
};

const countPaidExtraStoreCredits = async (userId: string) => {
  const candidates = [
    {
      select: "id,shop_id,status,stripe_session_id",
      hasShopId: true,
      hasStatus: true,
      hasStripeSessionId: true,
    },
    {
      select: "id,shop_id,status",
      hasShopId: true,
      hasStatus: true,
      hasStripeSessionId: false,
    },
    {
      select: "id,shop_id",
      hasShopId: true,
      hasStatus: false,
      hasStripeSessionId: false,
    },
    {
      select: "id",
      hasShopId: false,
      hasStatus: false,
      hasStripeSessionId: false,
    },
  ] as const;

  let lastError: QueryError | null = null;

  for (const candidate of candidates) {
    const query = await supabaseAdmin.from("payments").select(candidate.select).eq("user_id", userId).limit(5000);

    if (query.error) {
      lastError = query.error;
      if (!isRecoverableColumnError(query.error, ["shop_id", "status", "stripe_session_id"])) {
        throw new Error(query.error.message ?? "Could not load payments for store credits");
      }
      continue;
    }

    const rows = (query.data ?? []) as Array<{
      id?: string | null;
      shop_id?: string | null;
      status?: string | null;
      stripe_session_id?: string | null;
    }>;

    if (!candidate.hasShopId) {
      return 0;
    }

    const countedKeys = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const shopId = row.shop_id?.trim() ?? "";
      if (!shopId.startsWith(EXTRA_STORE_PAYMENT_PREFIX)) {
        continue;
      }

      if (candidate.hasStatus) {
        const status = (row.status ?? "").toLowerCase();
        if (status !== "paid") {
          continue;
        }
      }

      const uniqueKey =
        candidate.hasStripeSessionId && row.stripe_session_id
          ? `session:${row.stripe_session_id}`
          : `row:${row.id ?? index}`;

      countedKeys.add(uniqueKey);
    }

    return countedKeys.size;
  }

  if (lastError) {
    throw new Error(lastError.message ?? "Could not resolve store credits");
  }

  return 0;
};

const buildUpgradeOptions = (currentPlan: BillingPlan): StoreUpgradeOption[] => {
  const currentRank = PLAN_RANK[currentPlan];

  return PLAN_ORDER.filter((plan) => PLAN_RANK[plan] > currentRank).map((plan) => ({
    plan,
    includedStores: STORE_LIMITS_BY_PLAN[plan],
    monthlyPriceCents: PLAN_TO_MONTHLY_CENTS[plan],
  }));
};

export const buildExtraStorePaymentShopId = (plan: BillingPlan) => `${EXTRA_STORE_PAYMENT_PREFIX}${plan}`;

export const loadUserStoreQuota = async (userId: string): Promise<UserStoreQuota> => {
  const [{ plan, hasActiveSubscription }, totalStores, purchasedExtraStores] = await Promise.all([
    resolveEffectivePlan(userId),
    countUserStores(userId),
    countPaidExtraStoreCredits(userId),
  ]);

  const includedStoreLimit = STORE_LIMITS_BY_PLAN[plan];
  const usedExtraStores = Math.max(0, totalStores - includedStoreLimit);
  const remainingSlots = includedStoreLimit + purchasedExtraStores - totalStores;
  const canCreateStore = remainingSlots > 0;

  return {
    plan,
    hasActiveSubscription,
    includedStoreLimit,
    totalStores,
    purchasedExtraStores,
    usedExtraStores,
    remainingSlots,
    canCreateStore,
    extraStorePriceCents: EXTRA_STORE_PRICE_CENTS_BY_PLAN[plan],
    upgradeOptions: buildUpgradeOptions(plan),
  };
};
