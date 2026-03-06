import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
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

const appendRelayMagicLink = (url: URL, relayMl: string | null) => {
  if (relayMl) {
    url.searchParams.set("ml", relayMl);
  }

  return url;
};

const isValidSessionKey = (value: string | null): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);

const decodeBase64Url = (value: string) => {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const parseRelayMagicLink = (encoded: string | null) => {
  if (!encoded) {
    return null;
  }

  const decoded = decodeBase64Url(encoded);
  if (!decoded) {
    return null;
  }

  try {
    const target = new URL(decoded);
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    if (!supabaseHost || target.host !== supabaseHost || !target.pathname.includes("/auth/v1/verify")) {
      return null;
    }

    return {
      code: target.searchParams.get("code"),
      tokenHash: target.searchParams.get("token_hash") ?? target.searchParams.get("token"),
      tokenType: target.searchParams.get("type") ?? "magiclink",
      accessToken: target.searchParams.get("access_token"),
      refreshToken: target.searchParams.get("refresh_token"),
    };
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const nextPath = resolveSafeNextPath(requestUrl.searchParams.get("next"));
  const sessionKey = requestUrl.searchParams.get("session_key") ?? null;
  const relayMl = requestUrl.searchParams.get("ml");
  const relayAuth = parseRelayMagicLink(relayMl);

  const code = requestUrl.searchParams.get("code") ?? relayAuth?.code ?? null;
  const tokenHash = requestUrl.searchParams.get("token_hash") ?? relayAuth?.tokenHash ?? null;
  const tokenType = requestUrl.searchParams.get("type") ?? relayAuth?.tokenType ?? "magiclink";
  const accessToken = requestUrl.searchParams.get("access_token") ?? relayAuth?.accessToken ?? null;
  const refreshToken = requestUrl.searchParams.get("refresh_token") ?? relayAuth?.refreshToken ?? null;

  if (!code && tokenHash) {
    const verified = await supabaseServer.auth.verifyOtp({
      token_hash: tokenHash,
      type: tokenType as EmailOtpType,
    });

    if (!verified.error && verified.data.session && verified.data.user) {
      await bootstrapProfile({
        user: verified.data.user,
        fullName: (verified.data.user.user_metadata?.full_name as string | undefined) ?? undefined,
        locale: "tr",
      });

      const response = NextResponse.redirect(appendRelayMagicLink(new URL(nextPath, request.url), relayMl));
      setSessionCookies(response, verified.data.session.access_token, verified.data.session.refresh_token);
      return response;
    }
  }

  if (!code && accessToken && refreshToken) {
    const response = NextResponse.redirect(appendRelayMagicLink(new URL(nextPath, request.url), relayMl));
    setSessionCookies(response, accessToken, refreshToken);
    return response;
  }

  if (!code) {
    const passthroughKeys = [
      "token_hash",
      "type",
      "access_token",
      "refresh_token",
      "expires_in",
      "expires_at",
      "token_type",
    ];
    const hasAuthTokenParams = passthroughKeys.some((key) => requestUrl.searchParams.has(key));

    if (hasAuthTokenParams) {
      const redirectUrl = new URL(nextPath, request.url);
      for (const key of passthroughKeys) {
        const value = requestUrl.searchParams.get(key);
        if (value) {
          redirectUrl.searchParams.set(key, value);
        }
      }

      if (isValidSessionKey(sessionKey)) {
        redirectUrl.searchParams.set("session_key", sessionKey);
      }

      return NextResponse.redirect(appendRelayMagicLink(redirectUrl, relayMl));
    }

    if (nextPath === "/legacy-onboarding") {
      return NextResponse.redirect(appendRelayMagicLink(new URL(nextPath, request.url), relayMl));
    }

    // Implicit flow: tokens are in the URL fragment (#access_token=...).
    // The server cannot read the fragment, but if we have a session_key we can
    // redirect to extension-done WITH the session_key so the client-side page
    // can pick up the tokens from the fragment and complete the extension OAuth flow.
    if (isValidSessionKey(sessionKey)) {
      const redirectUrl = new URL(nextPath, request.url);
      redirectUrl.searchParams.set("session_key", sessionKey);
      return NextResponse.redirect(appendRelayMagicLink(redirectUrl, relayMl));
    }
    return NextResponse.redirect(appendRelayMagicLink(buildRedirectWithError(request.url, nextPath, "missing_code"), relayMl));
  }

  let exchangeSession = await supabaseServer.auth.exchangeCodeForSession(code);
  let session = exchangeSession.data.session ?? null;
  let user = exchangeSession.data.user ?? null;

  if ((exchangeSession.error || !session || !user) && tokenHash) {
    const verified = await supabaseServer.auth.verifyOtp({
      token_hash: tokenHash,
      type: tokenType as EmailOtpType,
    });
    if (!verified.error && verified.data.session && verified.data.user) {
      session = verified.data.session;
      user = verified.data.user;
      exchangeSession = {
        data: { session, user },
        error: null,
      } as typeof exchangeSession;
    }
  }

  if ((exchangeSession.error || !session || !user) && accessToken && refreshToken) {
    const candidate = await supabaseServer.auth.getUser(accessToken);
    if (!candidate.error && candidate.data.user) {
      user = candidate.data.user;
      session = {
        access_token: accessToken,
        refresh_token: refreshToken,
      } as typeof session;
      exchangeSession = {
        data: { session, user },
        error: null,
      } as typeof exchangeSession;
    }
  }

  if (!session || !user) {
    return NextResponse.redirect(
      appendRelayMagicLink(buildRedirectWithError(request.url, nextPath, "oauth_failed"), relayMl)
    );
  }

  await bootstrapProfile({
    user,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? undefined,
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
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
      });
    } catch {
      // Non-fatal — the extension will get a timeout and retry
    }
    return NextResponse.redirect(new URL("/auth/extension-done", request.url));
  }

  const response = NextResponse.redirect(appendRelayMagicLink(new URL(nextPath, request.url), relayMl));
  setSessionCookies(response, session.access_token, session.refresh_token);
  return response;
}
