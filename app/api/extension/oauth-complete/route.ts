import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompleteBody = {
  session_key?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompleteBody;
    const sessionKey = typeof body.session_key === "string" ? body.session_key.trim() : "";
    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";

    if (!sessionKey || !accessToken || !refreshToken) {
      return NextResponse.json({ error: "session_key, access_token and refresh_token are required." }, { status: 400 });
    }

    // Validate the session key format (basic check)
    if (!/^[a-f0-9-]{36}$/.test(sessionKey)) {
      return NextResponse.json({ error: "Invalid session_key format." }, { status: 400 });
    }

    // Upsert (in case of race conditions, just overwrite)
    const { error } = await supabaseAdmin
      .from("extension_oauth_sessions")
      .upsert(
        {
          session_key: sessionKey,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          used: false,
        },
        { onConflict: "session_key" }
      );

    if (error) {
      console.error("[extension/oauth-complete] upsert error:", error.message);
      return NextResponse.json({ error: "Failed to store OAuth session." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth complete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
