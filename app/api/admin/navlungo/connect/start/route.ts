import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { readNavlungoRuntimeConfig } from "@/lib/navlungo/config";
import {
  createNavlungoOauthCookiePayload,
  createPkceChallenge,
  setNavlungoOauthCookie,
} from "@/lib/navlungo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const config = readNavlungoRuntimeConfig();
  if (!config.clientId || !config.clientSecret) {
    return NextResponse.json({ error: "NAVLUNGO_CLIENT_ID / NAVLUNGO_CLIENT_SECRET eksik." }, { status: 400 });
  }

  const payload = createNavlungoOauthCookiePayload({
    environment: config.environment,
    returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/admin",
  });

  const authorizeUrl = new URL("/authorize", config.authBaseUrl);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("code_challenge", createPkceChallenge(payload.codeVerifier));
  authorizeUrl.searchParams.set("state", payload.state);

  const response = NextResponse.redirect(authorizeUrl);
  setNavlungoOauthCookie(response, payload);
  return response;
}
