import { NextRequest, NextResponse } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";
import { supabaseServer } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshBody = {
  refreshToken?: unknown;
};

const toTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RefreshBody;
    const refreshToken = toTrimmedString(body.refreshToken);

    if (!refreshToken) {
      return NextResponse.json({ error: "refreshToken is required." }, { status: 400 });
    }

    const { data, error } = await supabaseServer.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.user || !data.session?.access_token) {
      return NextResponse.json(
        { error: error?.message ?? "Session refresh failed." },
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
    const message = error instanceof Error ? error.message : "Session refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
