import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionKey = request.nextUrl.searchParams.get("session_key") ?? "";

    if (!sessionKey || !/^[a-f0-9-]{36}$/.test(sessionKey)) {
      return NextResponse.json({ ok: false, ready: false, error: "Invalid session_key." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("extension_oauth_sessions")
      .select("id, access_token, refresh_token, expires_at, used")
      .eq("session_key", sessionKey)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, ready: false }, { headers: { "cache-control": "no-store" } });
    }

    if (!data) {
      // Not ready yet
      return NextResponse.json({ ok: true, ready: false }, { headers: { "cache-control": "no-store" } });
    }

    if (data.used) {
      return NextResponse.json({ ok: false, ready: false, error: "Session already used." }, { status: 400 });
    }

    const expiresAt = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAt) {
      void supabaseAdmin.from("extension_oauth_sessions").delete().eq("session_key", sessionKey);
      return NextResponse.json({ ok: false, ready: false, error: "Session expired." }, { status: 400 });
    }

    // Mark as used
    await supabaseAdmin
      .from("extension_oauth_sessions")
      .update({ used: true })
      .eq("session_key", sessionKey);

    // Get user info from the access token
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(data.access_token);
    if (userError || !userData?.user) {
      return NextResponse.json({ ok: false, ready: false, error: "Invalid session token." }, { status: 401 });
    }

    const user = userData.user;

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
        ready: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        state,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth poll failed";
    return NextResponse.json({ ok: false, ready: false, error: message }, { status: 500 });
  }
}
