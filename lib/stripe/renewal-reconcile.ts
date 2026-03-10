import Stripe from "stripe";
import { getActiveStripeMode, getStripeClientForMode, type StripeMode } from "@/lib/stripe/client";
import { syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  stripe_mode?: string | null;
};

type ReconcileSummary = {
  ran: boolean;
  reason?: "not_window" | "no_rows";
  activeMode: StripeMode;
  scanned: number;
  selected: number;
  updated: number;
  skippedModeMismatch: number;
  skippedNotFound: number;
  failed: number;
  errors: Array<{ subscriptionId: string; message: string }>;
};

const TARGET_STATUSES = ["active", "trialing", "past_due", "incomplete", "unpaid"];
const RECONCILE_WINDOW_MINUTES = 30;
const HORIZON_MS = 36 * 60 * 60 * 1000;
const MAX_PER_RUN = 30;

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isRecoverableColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const toIsoFromUnix = (value: number | null | undefined) => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const resolveStoreId = (row: SubscriptionRow) => {
  if (row.store_id && isUuid(row.store_id)) {
    return row.store_id;
  }

  if (row.shop_id && isUuid(row.shop_id)) {
    return row.shop_id;
  }

  return null;
};

const shouldReconcileRow = (row: SubscriptionRow, nowMs: number) => {
  const status = (row.status ?? "").toLowerCase();
  if (!TARGET_STATUSES.includes(status)) {
    return false;
  }

  if (status === "past_due" || status === "incomplete" || status === "unpaid") {
    return true;
  }

  const periodEndMs = toTimestamp(row.current_period_end ?? null);
  if (periodEndMs === null) {
    return true;
  }

  return periodEndMs <= nowMs + HORIZON_MS;
};

const isWrongModeError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("a similar object exists in test mode") || normalized.includes("a similar object exists in live mode");
};

const isNotFoundError = (message: string) => {
  return message.toLowerCase().includes("no such subscription");
};

const loadCandidateRows = async (activeMode: StripeMode) => {
  const candidates = [
    {
      select:
        "id,user_id,store_id,shop_id,plan,status,current_period_end,stripe_subscription_id,stripe_customer_id,updated_at,created_at,stripe_mode",
      hasStripeMode: true,
    },
    {
      select:
        "id,user_id,store_id,shop_id,plan,status,current_period_end,stripe_subscription_id,stripe_customer_id,updated_at,created_at",
      hasStripeMode: false,
    },
  ] as const;

  let lastError: string | null = null;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("subscriptions")
      .select(candidate.select)
      .in("status", TARGET_STATUSES)
      .not("stripe_subscription_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (candidate.hasStripeMode) {
      query = query.eq("stripe_mode", activeMode);
    }

    const attempt = await query;
    if (!attempt.error) {
      return {
        rows: (attempt.data ?? []) as unknown as SubscriptionRow[],
        hasStripeMode: candidate.hasStripeMode,
      };
    }

    lastError = attempt.error.message;
    if (!isRecoverableColumnError(attempt.error, ["stripe_mode"])) {
      throw new Error(attempt.error.message);
    }
  }

  throw new Error(lastError ?? "subscriptions could not be loaded for Stripe reconcile");
};

const updateSubscriptionRow = async (args: {
  rowId: string;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeMode: StripeMode;
  hasStripeModeColumn: boolean;
}) => {
  const nowIso = new Date().toISOString();
  const payloadWithMode: Record<string, unknown> = {
    status: args.status,
    current_period_end: args.currentPeriodEnd,
    stripe_customer_id: args.stripeCustomerId,
    updated_at: nowIso,
    stripe_mode: args.stripeMode,
  };
  const payloadWithoutMode: Record<string, unknown> = {
    status: args.status,
    current_period_end: args.currentPeriodEnd,
    stripe_customer_id: args.stripeCustomerId,
    updated_at: nowIso,
  };
  let payload = args.hasStripeModeColumn ? payloadWithMode : payloadWithoutMode;

  let result = await supabaseAdmin.from("subscriptions").update(payload).eq("id", args.rowId);
  if (result.error && isMissingColumnError(result.error, "stripe_mode")) {
    payload = payloadWithoutMode;
    result = await supabaseAdmin.from("subscriptions").update(payload).eq("id", args.rowId);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }
};

const updateStoreStatus = async (storeId: string, status: string) => {
  const normalized = status.toLowerCase();
  const storeStatus = normalized === "active" || normalized === "trialing" ? "active" : normalized;
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    { status: storeStatus, updated_at: nowIso },
    { status: storeStatus },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("stores").update(payload).eq("id", storeId);
    if (!attempt.error) {
      return;
    }

    if (!isRecoverableColumnError(attempt.error, ["updated_at"])) {
      throw new Error(attempt.error.message);
    }
  }
};

const resolveStripePeriodEnd = (subscription: Stripe.Subscription) => {
  return subscription.items.data[0]?.current_period_end ?? null;
};

const shouldRunNow = (now: Date) => now.getUTCMinutes() % RECONCILE_WINDOW_MINUTES === 0;

export const runStripeRenewalReconcileTick = async (options?: { force?: boolean; now?: Date }): Promise<ReconcileSummary> => {
  const activeMode = getActiveStripeMode();
  const now = options?.now ?? new Date();
  if (!options?.force && !shouldRunNow(now)) {
    return {
      ran: false,
      reason: "not_window",
      activeMode,
      scanned: 0,
      selected: 0,
      updated: 0,
      skippedModeMismatch: 0,
      skippedNotFound: 0,
      failed: 0,
      errors: [],
    };
  }

  const { rows, hasStripeMode } = await loadCandidateRows(activeMode);
  if (!rows.length) {
    return {
      ran: false,
      reason: "no_rows",
      activeMode,
      scanned: 0,
      selected: 0,
      updated: 0,
      skippedModeMismatch: 0,
      skippedNotFound: 0,
      failed: 0,
      errors: [],
    };
  }

  const nowMs = now.getTime();
  const selectedRows = rows.filter((row) => shouldReconcileRow(row, nowMs)).slice(0, MAX_PER_RUN);

  const summary: ReconcileSummary = {
    ran: true,
    activeMode,
    scanned: rows.length,
    selected: selectedRows.length,
    updated: 0,
    skippedModeMismatch: 0,
    skippedNotFound: 0,
    failed: 0,
    errors: [],
  };

  for (const row of selectedRows) {
    const stripeSubscriptionId = row.stripe_subscription_id ?? null;
    if (!stripeSubscriptionId) {
      continue;
    }

    if (hasStripeMode && row.stripe_mode && row.stripe_mode !== activeMode) {
      summary.skippedModeMismatch += 1;
      continue;
    }

    try {
      const stripe = getStripeClientForMode(activeMode);
      const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      const currentPeriodEnd = toIsoFromUnix(resolveStripePeriodEnd(subscription));
      const stripeCustomerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id ?? null;
      const status = subscription.status;

      await updateSubscriptionRow({
        rowId: row.id,
        status,
        currentPeriodEnd,
        stripeCustomerId,
        stripeMode: activeMode,
        hasStripeModeColumn: hasStripeMode,
      });

      const storeId = resolveStoreId(row);
      if (storeId) {
        await updateStoreStatus(storeId, status);
      }

      await syncProfileSubscriptionState({
        userId: row.user_id ?? null,
        status,
        plan: row.plan ?? null,
        stripeCustomerId,
      });

      summary.updated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe reconcile failed";
      if (isWrongModeError(message)) {
        summary.skippedModeMismatch += 1;
        continue;
      }
      if (isNotFoundError(message)) {
        summary.skippedNotFound += 1;
        continue;
      }

      summary.failed += 1;
      if (summary.errors.length < 20) {
        summary.errors.push({
          subscriptionId: stripeSubscriptionId,
          message,
        });
      }
    }
  }

  return summary;
};
