import type { BillingPlan } from "@/lib/stripe/client";

export const STORE_LIMITS_BY_PLAN: Record<BillingPlan, number> = {
  standard: 4,
  pro: 6,
  turbo: 8,
};

export const ABSOLUTE_MAX_STORES_PER_USER = 10;

export const EXTRA_STORE_PRICE_CENTS_BY_PLAN: Record<BillingPlan, number> = {
  standard: 2000,
  pro: 2000,
  turbo: 1000,
};
