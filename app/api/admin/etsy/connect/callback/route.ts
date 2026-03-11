import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/admin-request";
import { upsertEtsyConnection } from "@/lib/etsy/connection";
import { buildEtsyCallbackUrl, readEtsyRuntimeConfig } from "@/lib/etsy/config";
import { clearEtsyAccessTokenCache, exchangeEtsyAuthorizationCode } from "@/lib/etsy/client";
import {
  clearEtsyOauthCookie,
  ETSY_OAUTH_COOKIE,
  parseEtsyOauthCookiePayload,
} from "@/lib/etsy/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildRedirectUrl = (request: NextRequest, returnTo: string, status: string, detail?: string) => {
  const target = new URL(returnTo, request.nextUrl.origin);
  target.searchParams.set("etsy", status);
  if (detail) {
    target.searchParams.set("etsyDetail", detail);
  }
  return target;
};

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(ETSY_OAUTH_COOKIE)?.value ?? null;
  const cookiePayload = parseEtsyOauthCookiePayload(cookieValue);
  const fallbackReturnTo = cookiePayload?.returnTo ?? "/admin";

  const finalizeRedirect = (status: string, detail?: string) => {
    const response = NextResponse.redirect(buildRedirectUrl(request, fallbackReturnTo, status, detail));
    clearEtsyOauthCookie(response);
    return response;
  };

  if (!cookiePayload) {
    return finalizeRedirect("error", "oauth_cookie_missing");
  }

  const returnedState = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  if (!returnedState || returnedState !== cookiePayload.state) {
    return finalizeRedirect("error", "oauth_state_mismatch");
  }

  const error = request.nextUrl.searchParams.get("error")?.trim();
  if (error) {
    return finalizeRedirect("error", error);
  }

  const code = request.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return finalizeRedirect("error", "missing_code");
  }

  try {
    const admin = await requireAdminRequest(request);
    const config = readEtsyRuntimeConfig();
    const tokenResponse = await exchangeEtsyAuthorizationCode({
      code,
      codeVerifier: cookiePayload.codeVerifier,
      redirectUri: buildEtsyCallbackUrl(request.nextUrl.origin),
    });

    if (!tokenResponse.refreshToken) {
      throw new Error("Etsy authorization response did not include refresh_token.");
    }

    const accessTokenExpiresAt = new Date(Date.now() + tokenResponse.expiresInSeconds * 1000).toISOString();

    await upsertEtsyConnection({
      clientId: config.clientId,
      etsyUserId: tokenResponse.etsyUserId,
      refreshToken: tokenResponse.refreshToken,
      accessToken: tokenResponse.accessToken,
      accessTokenExpiresAt,
      tokenType: tokenResponse.tokenType,
      connectedAt: new Date().toISOString(),
      createdBy: admin?.user.id ?? null,
      updatedBy: admin?.user.id ?? null,
    });

    clearEtsyAccessTokenCache();
    return finalizeRedirect("connected");
  } catch (callbackError) {
    return finalizeRedirect(
      "error",
      callbackError instanceof Error ? callbackError.message : "etsy_callback_failed"
    );
  }
}
