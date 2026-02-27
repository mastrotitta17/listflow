import { NextRequest, NextResponse } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { setSessionCookies } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/admin";

const resolveSafeNextPath = (value: string | null) => {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
};

const buildRedirectWithError = (requestUrl: string, nextPath: string, authError: string) => {
  const url = new URL(nextPath, requestUrl);
  url.searchParams.set("authError", authError);
  return url;
};

const isValidSessionKey = (value: string | null): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = resolveSafeNextPath(requestUrl.searchParams.get("next"));
  const sessionKey = requestUrl.searchParams.get("session_key") ?? null;

  if (!code) {
    // Implicit flow: tokens are in the URL fragment (#access_token=...).
    // The server cannot read the fragment, but if we have a session_key we can
    // redirect to extension-done WITH the session_key so the client-side page
    // can pick up the tokens from the fragment and complete the extension OAuth flow.
    if (isValidSessionKey(sessionKey)) {
      const redirectUrl = new URL(nextPath, request.url);
      redirectUrl.searchParams.set("session_key", sessionKey);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.redirect(buildRedirectWithError(request.url, nextPath, "missing_code"));
  }

  const { data, error } = await supabaseServer.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(buildRedirectWithError(request.url, nextPath, "oauth_failed"));
  }

  await bootstrapProfile({
    user: data.user,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? undefined,
    locale: "tr",
  });

  // Extension OAuth flow: store tokens for the polling endpoint
  if (isValidSessionKey(sessionKey)) {
    try {
      const origin = requestUrl.origin;
      await fetch(`${origin}/api/extension/oauth-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: sessionKey,
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }),
      });
    } catch {
      // Non-fatal — the extension will get a timeout and retry
    }
    return NextResponse.redirect(new URL("/auth/extension-done", request.url));
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  setSessionCookies(response, data.session.access_token, data.session.refresh_token);
  return response;
}
