import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripeClientForMode } from "@/lib/stripe/client";

type RewardType = "discount_20pct" | "cash_250";

type QualifyReferralArgs = {
  referredUserId: string;
  storeId: string | null;
  plan: string | null | undefined;
};

type QualifyReferralResult =
  | { ok: true; qualified: true }
  | {
      ok: true;
      qualified: false;
      reason:
        | "plan_not_eligible"
        | "store_not_resolved"
        | "not_first_store"
        | "no_conversion";
    };

const normalizePlan = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

const isEligibleReferralPlan = (plan: string | null | undefined) => {
  const normalized = normalizePlan(plan);
  return normalized === "pro" || normalized === "turbo";
};

const isFirstStoreForUser = async (userId: string, storeId: string) => {
  const result = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data?.id === storeId;
};

const issueRewardIfNeeded = async (args: {
  referrerUserId: string;
  milestone: number;
  type: RewardType;
}) => {
  const { data: existingReward } = await supabaseAdmin
    .from("referral_rewards")
    .select("id")
    .eq("user_id", args.referrerUserId)
    .eq("milestone", args.milestone)
    .maybeSingle<{ id: string }>();

  if (existingReward) {
    return;
  }

  if (args.type === "discount_20pct") {
    try {
      const stripe = getStripeClientForMode();
      const coupon = await stripe.coupons.create({
        percent_off: 20,
        duration: "once",
        name: "Referral Reward – 20% off",
        metadata: {
          referrer_user_id: args.referrerUserId,
          milestone: String(args.milestone),
        },
      });

      const promoCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        max_redemptions: 1,
        metadata: {
          referrer_user_id: args.referrerUserId,
          milestone: String(args.milestone),
        },
      });

      await supabaseAdmin.from("referral_rewards").insert({
        user_id: args.referrerUserId,
        reward_type: args.type,
        milestone: args.milestone,
        stripe_coupon_id: coupon.id,
        stripe_promotion_code_id: promoCode.id,
        promo_code: promoCode.code,
        status: "issued",
      });
      return;
    } catch {
      await supabaseAdmin.from("referral_rewards").insert({
        user_id: args.referrerUserId,
        reward_type: args.type,
        milestone: args.milestone,
        status: "pending",
      });
      return;
    }
  }

  await supabaseAdmin.from("referral_rewards").insert({
    user_id: args.referrerUserId,
    reward_type: args.type,
    milestone: args.milestone,
    status: "pending",
  });
};

export const qualifyReferralConversion = async (
  args: QualifyReferralArgs
): Promise<QualifyReferralResult> => {
  if (!isEligibleReferralPlan(args.plan)) {
    return { ok: true, qualified: false, reason: "plan_not_eligible" };
  }

  if (!args.storeId) {
    return { ok: true, qualified: false, reason: "store_not_resolved" };
  }

  const firstStore = await isFirstStoreForUser(args.referredUserId, args.storeId);
  if (!firstStore) {
    return { ok: true, qualified: false, reason: "not_first_store" };
  }

  const { data: conversion } = await supabaseAdmin
    .from("referral_conversions")
    .select("id, referrer_user_id, status")
    .eq("referred_user_id", args.referredUserId)
    .eq("status", "pending")
    .maybeSingle<{ id: string; referrer_user_id: string; status: string }>();

  if (!conversion) {
    return { ok: true, qualified: false, reason: "no_conversion" };
  }

  await supabaseAdmin
    .from("referral_conversions")
    .update({
      status: "qualified",
      subscribed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversion.id);

  const { count: qualifiedCount } = await supabaseAdmin
    .from("referral_conversions")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", conversion.referrer_user_id)
    .eq("status", "qualified");

  const total = qualifiedCount ?? 0;
  const milestones: Array<{ count: number; type: RewardType }> = [
    { count: 5, type: "discount_20pct" },
    { count: 10, type: "cash_250" },
  ];

  for (const milestone of milestones) {
    if (total >= milestone.count) {
      await issueRewardIfNeeded({
        referrerUserId: conversion.referrer_user_id,
        milestone: milestone.count,
        type: milestone.type,
      });
    }
  }

  return { ok: true, qualified: true };
};
