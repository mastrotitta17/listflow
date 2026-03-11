import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { clearEtsyAccessTokenCache } from "@/lib/etsy/client";
import { deleteEtsyConnection } from "@/lib/etsy/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  await deleteEtsyConnection();
  clearEtsyAccessTokenCache();

  return NextResponse.redirect(new URL("/admin?etsy=disconnected", request.nextUrl.origin), { status: 303 });
}
