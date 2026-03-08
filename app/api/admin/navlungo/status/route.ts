import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getNavlungoConnection } from "@/lib/navlungo/connection";
import { buildNavlungoCallbackUrl, readNavlungoRuntimeConfig } from "@/lib/navlungo/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const config = readNavlungoRuntimeConfig();
  const connection = await getNavlungoConnection(config.environment);

  return NextResponse.json({
    environment: config.environment,
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(connection),
    connectedEmail: connection?.connected_email ?? null,
    connectedAt: connection?.connected_at ?? null,
    updatedAt: connection?.updated_at ?? null,
    callbackUrl: buildNavlungoCallbackUrl(request.nextUrl.origin),
  });
}
