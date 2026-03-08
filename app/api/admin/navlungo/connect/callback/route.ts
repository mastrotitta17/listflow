import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/admin-request";
import { upsertNavlungoConnection } from "@/lib/navlungo/connection";
import { readNavlungoRuntimeConfig } from "@/lib/navlungo/config";
import { clearNavlungoAccessTokenCache, exchangeNavlungoAuthorizationCode } from "@/lib/navlungo/client";
import {
  NAVLUNGO_OAUTH_COOKIE,
  clearNavlungoOauthCookie,
  parseNavlungoOauthCookiePayload,
} from "@/lib/navlungo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extractEmailFromIdToken = (idToken: string | null) => {
  if (!idToken) {
    return null;
  }

  const parts = idToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const emailCandidates = [payload.email, payload.preferred_username, payload.unique_name, payload.upn];
    const email = emailCandidates.find((value) => typeof value === "string" && value.trim()) as string | undefined;
    return email?.trim() ?? null;
  } catch {
    return null;
  }
};

const buildRedirectUrl = (request: NextRequest, returnTo: string, status: string, detail?: string) => {
  const target = new URL(returnTo, request.nextUrl.origin);
  target.searchParams.set("navlungo", status);
  if (detail) {
    target.searchParams.set("navlungoDetail", detail);
  }
  return target;
};

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(NAVLUNGO_OAUTH_COOKIE)?.value ?? null;
  const cookiePayload = parseNavlungoOauthCookiePayload(cookieValue);
  const fallbackReturnTo = cookiePayload?.returnTo ?? "/admin";

  const finalizeRedirect = (status: string, detail?: string) => {
    const response = NextResponse.redirect(buildRedirectUrl(request, fallbackReturnTo, status, detail));
    clearNavlungoOauthCookie(response);
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
    const config = readNavlungoRuntimeConfig();
    const tokenResponse = await exchangeNavlungoAuthorizationCode({
      code,
      codeVerifier: cookiePayload.codeVerifier,
      environment: cookiePayload.environment,
    });

    if (!tokenResponse.refreshToken) {
      throw new Error("Navlungo authorization response did not include refresh_token.");
    }

    const accessTokenExpiresAt = new Date(Date.now() + tokenResponse.expiresInSeconds * 1000).toISOString();

    await upsertNavlungoConnection({
      environment: cookiePayload.environment,
      clientId: config.clientId,
      refreshToken: tokenResponse.refreshToken,
      accessToken: tokenResponse.accessToken,
      accessTokenExpiresAt,
      connectedEmail: extractEmailFromIdToken(tokenResponse.idToken),
      connectedAt: new Date().toISOString(),
      createdBy: admin?.user.id ?? null,
      updatedBy: admin?.user.id ?? null,
    });

    clearNavlungoAccessTokenCache(cookiePayload.environment);
    return finalizeRedirect("connected");
  } catch (callbackError) {
    return finalizeRedirect(
      "error",
      callbackError instanceof Error ? callbackError.message : "navlungo_callback_failed"
    );
  }
}
