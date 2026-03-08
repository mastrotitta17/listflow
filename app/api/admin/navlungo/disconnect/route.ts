import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { deleteNavlungoConnection } from "@/lib/navlungo/connection";
import { readNavlungoRuntimeConfig } from "@/lib/navlungo/config";
import { clearNavlungoAccessTokenCache } from "@/lib/navlungo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const config = readNavlungoRuntimeConfig();
  await deleteNavlungoConnection(config.environment);
  clearNavlungoAccessTokenCache(config.environment);

  return NextResponse.redirect(new URL("/admin?navlungo=disconnected", request.nextUrl.origin), { status: 303 });
}
