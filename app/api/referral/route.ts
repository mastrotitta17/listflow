import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripeClientForMode } from "@/lib/stripe/client";

export const runtime = "nodejs";

// Generates a short random alphanumeric referral code
const generateCode = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

// GET /api/referral — returns user's referral code (creates one if missing) + stats
export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch or create referral code
    let { data: codeRow } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code")
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; code: string }>();

    if (!codeRow) {
      let code = generateCode();
      let attempts = 0;

      while (attempts < 5) {
        const insert = await supabaseAdmin
          .from("referral_codes")
          .insert({ user_id: user.id, code })
          .select("id, code")
          .maybeSingle<{ id: string; code: string }>();

        if (!insert.error) {
          codeRow = insert.data;
          break;
        }

        if (insert.error.code === "23505") {
          // Unique violation — try a new code
          code = generateCode();
          attempts++;
          continue;
        }

        return NextResponse.json({ error: insert.error.message }, { status: 500 });
      }

      if (!codeRow) {
        return NextResponse.json({ error: "Failed to generate referral code" }, { status: 500 });
      }
    }

    // Fetch conversion stats
    const { data: conversions } = await supabaseAdmin
      .from("referral_conversions")
      .select("id, status, signed_up_at, subscribed_at")
      .eq("referrer_user_id", user.id)
      .order("signed_up_at", { ascending: false });

    const allConversions = (conversions ?? []) as Array<{
      id: string;
      status: string;
      signed_up_at: string;
      subscribed_at: string | null;
    }>;

    const totalSignups = allConversions.length;
    const qualifiedCount = allConversions.filter((c) => c.status === "qualified").length;
    const pendingCount = allConversions.filter((c) => c.status === "pending").length;

    // Fetch rewards
    const { data: rewards } = await supabaseAdmin
      .from("referral_rewards")
      .select("id, reward_type, milestone, promo_code, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      code: codeRow.code,
      stats: {
        totalSignups,
        qualifiedCount,
        pendingCount,
      },
      conversions: allConversions.slice(0, 20),
      rewards: rewards ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Referral fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/referral — track a referral signup or qualify a conversion
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action: "track_signup" | "qualify";
      referralCode?: string;
      referredUserId?: string;
    };

    if (body.action === "track_signup") {
      // Called after a new user signs up using a referral code
      const { referralCode, referredUserId } = body;

      if (!referralCode || !referredUserId) {
        return NextResponse.json({ error: "Missing referralCode or referredUserId" }, { status: 400 });
      }

      // Look up the referral code
      const { data: codeRow } = await supabaseAdmin
        .from("referral_codes")
        .select("id, user_id, code")
        .eq("code", referralCode.toUpperCase())
        .maybeSingle<{ id: string; user_id: string; code: string }>();

      if (!codeRow) {
        return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });
      }

      // Prevent self-referral
      if (codeRow.user_id === referredUserId) {
        return NextResponse.json({ ok: false, reason: "self_referral" });
      }

      // Check if already tracked
      const { data: existing } = await supabaseAdmin
        .from("referral_conversions")
        .select("id")
        .eq("referred_user_id", referredUserId)
        .maybeSingle<{ id: string }>();

      if (existing) {
        return NextResponse.json({ ok: true, already_tracked: true });
      }

      const { error: insertError } = await supabaseAdmin
        .from("referral_conversions")
        .insert({
          referral_code: codeRow.code,
          referrer_user_id: codeRow.user_id,
          referred_user_id: referredUserId,
          status: "pending",
        });

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    if (body.action === "qualify") {
      // Called when a referred user makes their first active subscription
      const { referredUserId } = body;

      if (!referredUserId) {
        return NextResponse.json({ error: "Missing referredUserId" }, { status: 400 });
      }

      // Find the pending conversion for this user
      const { data: conversion } = await supabaseAdmin
        .from("referral_conversions")
        .select("id, referrer_user_id, status")
        .eq("referred_user_id", referredUserId)
        .eq("status", "pending")
        .maybeSingle<{ id: string; referrer_user_id: string; status: string }>();

      if (!conversion) {
        return NextResponse.json({ ok: true, no_conversion: true });
      }

      // Mark as qualified
      await supabaseAdmin
        .from("referral_conversions")
        .update({
          status: "qualified",
          subscribed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversion.id);

      // Count qualified conversions for this referrer
      const { count: qualifiedCount } = await supabaseAdmin
        .from("referral_conversions")
        .select("id", { count: "exact", head: true })
        .eq("referrer_user_id", conversion.referrer_user_id)
        .eq("status", "qualified");

      const total = qualifiedCount ?? 0;

      // Check milestones and issue rewards if needed
      const milestones = [
        { count: 5, type: "discount_20pct" as const },
        { count: 10, type: "cash_250" as const },
      ];

      for (const milestone of milestones) {
        if (total >= milestone.count) {
          // Check if reward already issued
          const { data: existingReward } = await supabaseAdmin
            .from("referral_rewards")
            .select("id")
            .eq("user_id", conversion.referrer_user_id)
            .eq("milestone", milestone.count)
            .maybeSingle<{ id: string }>();

          if (!existingReward) {
            if (milestone.type === "discount_20pct") {
              // Create Stripe coupon + promo code for 20% off
              try {
                const stripe = getStripeClientForMode();
                const coupon = await stripe.coupons.create({
                  percent_off: 20,
                  duration: "once",
                  name: `Referral Reward - 20% off`,
                  metadata: { referrer_user_id: conversion.referrer_user_id, milestone: "5" },
                });

                const promoCode = await stripe.promotionCodes.create({
                  promotion: { type: "coupon", coupon: coupon.id },
                  max_redemptions: 1,
                  metadata: { referrer_user_id: conversion.referrer_user_id, milestone: "5" },
                });

                await supabaseAdmin.from("referral_rewards").insert({
                  user_id: conversion.referrer_user_id,
                  reward_type: milestone.type,
                  milestone: milestone.count,
                  stripe_coupon_id: coupon.id,
                  stripe_promotion_code_id: promoCode.id,
                  promo_code: promoCode.code,
                  status: "issued",
                });
              } catch {
                // Still record the reward even if Stripe fails
                await supabaseAdmin.from("referral_rewards").insert({
                  user_id: conversion.referrer_user_id,
                  reward_type: milestone.type,
                  milestone: milestone.count,
                  status: "pending",
                });
              }
            } else {
              // $250 cash reward — record it, process manually
              await supabaseAdmin.from("referral_rewards").insert({
                user_id: conversion.referrer_user_id,
                reward_type: milestone.type,
                milestone: milestone.count,
                status: "pending",
              });
            }
          }
        }
      }

      return NextResponse.json({ ok: true, qualifiedCount: total });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Referral action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
