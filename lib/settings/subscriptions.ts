import {
  getActiveStripeMode,
  getStripeClientForMode,
  type BillingInterval,
  type BillingPlan,
  type StripeMode,
} from "@/lib/stripe/client";
import { buildStoreAliasIndex, type StoreAliasReference } from "@/lib/subscriptions/store-resolution";
import { serverEnv } from "@/lib/env/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export type SettingsSubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type RenewalState = "active" | "renewal_required" | "activation_required";

export type StoreSubscriptionSnapshot = {
  rows: SettingsSubscriptionRow[];
  activeSubscription: SettingsSubscriptionRow | null;
  latestSubscription: SettingsSubscriptionRow | null;
  renewalRequired: boolean;
  renewalState: RenewalState;
  currentPeriodEnd: string | null;
  lastSubscriptionPlan: BillingPlan | null;
  lastSubscriptionInterval: BillingInterval | null;
};

export type StripeCancelFailure = {
  id: string;
  stripeSubscriptionId: string;
  message: string;
};

const isStripeNotFoundError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("no such subscription") || normalized.includes("no such customer");
};

const isStripeAlreadyEndedError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already canceled") ||
    (normalized.includes("cannot be canceled") && normalized.includes("canceled")) ||
    (normalized.includes("cannot be canceled") && normalized.includes("incomplete_expired"))
  );
};

const resolveModeAttemptOrder = (activeMode: StripeMode): StripeMode[] => {
  return activeMode === "live" ? ["live", "test"] : ["test", "live"];
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const toDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toTimestamp = (row: Pick<SettingsSubscriptionRow, "updated_at" | "created_at">) => {
  const value = row.updated_at ?? row.created_at ?? null;
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeBillingPlan = (value: string | null | undefined): BillingPlan | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "standard" || normalized === "pro" || normalized === "turbo") {
    return normalized;
  }

  return null;
};

export const isSubscriptionActive = (row: SettingsSubscriptionRow) => {
  const status = (row.status ?? "").toLowerCase();
  if (!["active", "trialing"].includes(status)) {
    return false;
  }

  const periodEnd = toDate(row.current_period_end);
  if (!periodEnd) {
    return true;
  }

  return periodEnd.getTime() > Date.now();
};

export const sortSubscriptionsNewest = <T extends Pick<SettingsSubscriptionRow, "updated_at" | "created_at">>(rows: T[]) => {
  return [...rows].sort((a, b) => toTimestamp(b) - toTimestamp(a));
};

export const resolveRenewalState = (rows: SettingsSubscriptionRow[]): RenewalState => {
  const normalized = sortSubscriptionsNewest(rows);
  if (normalized.some((row) => isSubscriptionActive(row))) {
    return "active";
  }

  if (normalized.length > 0) {
    return "renewal_required";
  }

  return "activation_required";
};

export const summarizeStoreSubscriptions = (rows: SettingsSubscriptionRow[], options?: {
  lastSubscriptionInterval?: BillingInterval | null;
}): StoreSubscriptionSnapshot => {
  const normalizedRows = sortSubscriptionsNewest(rows);
  const activeSubscription = normalizedRows.find((row) => isSubscriptionActive(row)) ?? null;
  const latestSubscription = normalizedRows[0] ?? null;
  const renewalState = resolveRenewalState(normalizedRows);

  return {
    rows: normalizedRows,
    activeSubscription,
    latestSubscription,
    renewalRequired: renewalState === "renewal_required",
    renewalState,
    currentPeriodEnd: activeSubscription?.current_period_end ?? latestSubscription?.current_period_end ?? null,
    lastSubscriptionPlan: normalizeBillingPlan(activeSubscription?.plan ?? latestSubscription?.plan ?? null),
    lastSubscriptionInterval: options?.lastSubscriptionInterval ?? null,
  };
};

export const resolveStoreIdFromSubscription = (row: SettingsSubscriptionRow) => {
  if (row.store_id) {
    return row.store_id;
  }

  return row.shop_id && isUuid(row.shop_id) ? row.shop_id : null;
};

export type SubscriptionStoreIdResolver = (row: SettingsSubscriptionRow) => string | null;

export const buildSubscriptionStoreIdResolver = (stores: StoreAliasReference[]): SubscriptionStoreIdResolver => {
  const aliasIndex = buildStoreAliasIndex(stores);

  return (row: SettingsSubscriptionRow) => {
    const explicit = resolveStoreIdFromSubscription(row);
    if (explicit) {
      return explicit;
    }

    return aliasIndex.resolve({
      user_id: row.user_id ?? null,
      store_id: row.store_id ?? null,
      shop_id: row.shop_id ?? null,
    });
  };
};

export const filterSubscriptionsForStore = (
  rows: SettingsSubscriptionRow[],
  storeId: string,
  options?: {
    resolveStoreId?: SubscriptionStoreIdResolver;
  }
) => {
  const resolveStoreId = options?.resolveStoreId ?? resolveStoreIdFromSubscription;
  return rows.filter((row) => resolveStoreId(row) === storeId);
};

export const loadUserSubscriptions = async (userId: string) => {
  const stripeMode = serverEnv.STRIPE_MODE;
  const candidates = [
    {
      select:
        "id, user_id, store_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at, stripe_mode",
      hasStoreId: true,
      hasStripeMode: true,
    },
    {
      select:
        "id, user_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at, stripe_mode",
      hasStoreId: false,
      hasStripeMode: true,
    },
    {
      select:
        "id, user_id, store_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at",
      hasStoreId: true,
      hasStripeMode: false,
    },
    {
      select:
        "id, user_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at",
      hasStoreId: false,
      hasStripeMode: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("subscriptions")
      .select(candidate.select)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (candidate.hasStripeMode) {
      query = query.or(`stripe_mode.eq.${stripeMode},stripe_mode.is.null`);
    }

    const attempt = await query;
    if (!attempt.error) {
      return (((attempt.data ?? []) as unknown) as SettingsSubscriptionRow[]).map((row) => ({
        ...row,
        store_id: candidate.hasStoreId ? row.store_id ?? null : row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
      }));
    }

    lastError = attempt.error.message;
    const missingStore = isMissingColumnError(attempt.error, "store_id");
    const missingStripeMode = isMissingColumnError(attempt.error, "stripe_mode");
    if (!missingStore && !missingStripeMode) {
      throw new Error(attempt.error.message);
    }
  }

  throw new Error(lastError ?? "subscriptions could not be loaded");
};

export const resolveStripeBillingIntervalForSubscription = async (
  row: Pick<SettingsSubscriptionRow, "stripe_subscription_id">
): Promise<BillingInterval | null> => {
  const stripeSubscriptionId = row.stripe_subscription_id ?? null;
  if (!stripeSubscriptionId) {
    return null;
  }

  const activeMode = getActiveStripeMode();
  const modeOrder = resolveModeAttemptOrder(activeMode);

  for (const mode of modeOrder) {
    try {
      const subscription = await getStripeClientForMode(mode).subscriptions.retrieve(stripeSubscriptionId);
      const interval = subscription.items.data[0]?.price?.recurring?.interval;
      if (interval === "month" || interval === "year") {
        return interval;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe subscription load failed";
      if (isStripeNotFoundError(message)) {
        continue;
      }
    }
  }

  return null;
};

export const cancelStripeSubscriptionsNow = async (rows: SettingsSubscriptionRow[]) => {
  const activeMode = getActiveStripeMode();
  const modeOrder = resolveModeAttemptOrder(activeMode);
  const failed: StripeCancelFailure[] = [];
  const canceledIds: string[] = [];
  const missingStripeIds: string[] = [];

  for (const row of rows) {
    const stripeSubscriptionId = row.stripe_subscription_id;
    if (!stripeSubscriptionId) {
      missingStripeIds.push(row.id);
      continue;
    }

    let canceled = false;
    const attemptMessages: string[] = [];

    for (const mode of modeOrder) {
      try {
        await getStripeClientForMode(mode).subscriptions.cancel(stripeSubscriptionId);
        canceledIds.push(row.id);
        canceled = true;
        break;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Stripe cancellation failed";
        attemptMessages.push(`[${mode}] ${rawMessage}`);

        if (isStripeAlreadyEndedError(rawMessage)) {
          canceledIds.push(row.id);
          canceled = true;
          break;
        }

        if (isStripeNotFoundError(rawMessage)) {
          continue;
        }

        break;
      }
    }

    if (canceled) {
      continue;
    }

    const allNotFound = attemptMessages.length > 0 && attemptMessages.every((item) => isStripeNotFoundError(item));
    if (allNotFound) {
      // Record looks stale in Stripe (missing in tried modes) => treat as canceled to unblock store flow.
      canceledIds.push(row.id);
      continue;
    }

    const message =
      attemptMessages.length > 0
        ? attemptMessages.join(" | ")
        : `Stripe cancellation failed in configured mode (${activeMode}).`;

    failed.push({
      id: row.id,
      stripeSubscriptionId,
      message,
    });
  }

  return {
    canceledIds,
    failed,
    missingStripeIds,
  };
};
