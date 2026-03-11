import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { buildEtsyCallbackUrl, readEtsyRuntimeConfig } from "@/lib/etsy/config";
import {
  createEtsyOauthCookiePayload,
  createPkceChallenge,
  setEtsyOauthCookie,
} from "@/lib/etsy/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const config = readEtsyRuntimeConfig();
  if (!config.clientId || !config.clientSecret) {
    return NextResponse.json({ error: "ETSY_CLIENT_ID / ETSY_CLIENT_SECRET eksik." }, { status: 400 });
  }

  const payload = createEtsyOauthCookiePayload({
    returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/admin",
  });

  const authorizeUrl = new URL("/oauth/connect", config.authBaseUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", buildEtsyCallbackUrl(request.nextUrl.origin));
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("state", payload.state);
  authorizeUrl.searchParams.set("code_challenge", createPkceChallenge(payload.codeVerifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  setEtsyOauthCookie(response, payload);
  return response;
}
