import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { qualifyReferralConversion } from "@/lib/referral/qualify";

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
      storeId?: string;
      plan?: string;
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
      const { referredUserId, storeId, plan } = body;

      if (!referredUserId) {
        return NextResponse.json({ error: "Missing referredUserId" }, { status: 400 });
      }

      const result = await qualifyReferralConversion({
        referredUserId,
        storeId: storeId ?? null,
        plan,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Referral action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
