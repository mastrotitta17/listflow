import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";
import { supabaseServer } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

const toTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody;
    const email = toTrimmedString(body.email).toLowerCase();
    const password = toTrimmedString(body.password);

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
    }

    const { data, error } = await supabaseServer.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session?.access_token) {
      return NextResponse.json(
        { error: error?.message ?? "Invalid credentials." },
        { status: 401 }
      );
    }

    // Check if MFA upgrade is required for this session
    const userClient = createClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    await userClient.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });

    const [factorsResult, aalResult] = await Promise.all([
      userClient.auth.mfa.listFactors(),
      userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    type MfaFactor = { id: string; factor_type: string; status: string };
    const verifiedTotp = ((factorsResult.data?.all ?? []) as MfaFactor[]).find(
      (f) => f.factor_type === "totp" && f.status === "verified"
    ) ?? null;

    const needsMfa =
      Boolean(verifiedTotp) &&
      aalResult.data?.nextLevel === "aal2" &&
      aalResult.data?.currentLevel !== "aal2";

    if (needsMfa && verifiedTotp) {
      return NextResponse.json(
        {
          ok: true,
          mfa_required: true,
          factor_id: verifiedTotp.id,
          temp_access_token: data.session.access_token,
          temp_refresh_token: data.session.refresh_token,
        },
        { headers: { "cache-control": "no-store" } }
      );
    }

    // No MFA required — proceed normally
    await bootstrapProfile({
      user: data.user,
      fullName:
        typeof data.user.user_metadata?.full_name === "string"
          ? data.user.user_metadata.full_name
          : null,
      locale: "tr",
    });

    const state = await buildExtensionStateSnapshot({
      userId: data.user.id,
      email: data.user.email ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        state,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extension login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
