import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getEtsyConnection } from "@/lib/etsy/connection";
import { buildEtsyCallbackUrl, readEtsyRuntimeConfig } from "@/lib/etsy/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const config = readEtsyRuntimeConfig();
  const connection = await getEtsyConnection();

  return NextResponse.json({
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(connection),
    etsyUserId: connection?.etsy_user_id ?? null,
    connectedAt: connection?.connected_at ?? null,
    updatedAt: connection?.updated_at ?? null,
    callbackUrl: buildEtsyCallbackUrl(request.nextUrl.origin),
    scopes: config.scopes,
  });
}
