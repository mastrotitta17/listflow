import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyMfaBody = {
  factor_id?: unknown;
  code?: unknown;
  temp_access_token?: unknown;
  temp_refresh_token?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyMfaBody;

    const factorId = typeof body.factor_id === "string" ? body.factor_id.trim() : "";
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "").slice(0, 6) : "";
    const tempAccessToken = typeof body.temp_access_token === "string" ? body.temp_access_token.trim() : "";
    const tempRefreshToken = typeof body.temp_refresh_token === "string" ? body.temp_refresh_token.trim() : "";

    if (!factorId || !code || !tempAccessToken || !tempRefreshToken) {
      return NextResponse.json({ error: "factor_id, code, temp_access_token and temp_refresh_token are required." }, { status: 400 });
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Code must be exactly 6 digits." }, { status: 400 });
    }

    // Create a user-scoped client and set the AAL1 session
    const userClient = createClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { error: sessionError } = await userClient.auth.setSession({
      access_token: tempAccessToken,
      refresh_token: tempRefreshToken,
    });

    if (sessionError) {
      return NextResponse.json({ error: "Invalid session. Please log in again." }, { status: 401 });
    }

    // Upgrade to AAL2 by verifying the TOTP code
    const { error: verifyError } = await userClient.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (verifyError) {
      return NextResponse.json(
        { error: verifyError.message ?? "Invalid code. Please try again." },
        { status: 401 }
      );
    }

    const { data: sessionData } = await userClient.auth.getSession();
    const session = sessionData?.session;
    if (!session?.access_token) {
      return NextResponse.json({ error: "MFA verification failed." }, { status: 401 });
    }

    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return NextResponse.json({ error: "Could not retrieve user after MFA." }, { status: 401 });
    }

    await bootstrapProfile({
      user,
      fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
      locale: "tr",
    });

    const state = await buildExtensionStateSnapshot({
      userId: user.id,
      email: user.email ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at ?? null,
        state,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "MFA verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
