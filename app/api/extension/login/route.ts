import { NextRequest, NextResponse } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";
import { supabaseServer } from "@/lib/supabase/admin";

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
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extension login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
