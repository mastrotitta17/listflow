import { NextRequest, NextResponse } from "next/server";
import { claimNextGuestSheetListing } from "@/lib/extension/guest-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = typeof body?.client_id === "string" ? body.client_id.trim() : "";

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "client_id is required" }, { status: 400 });
    }

    const result = await claimNextGuestSheetListing(clientId);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "No pending product found", code: "NO_PENDING" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, sheet_row_id: result.sheetRowId, listing_payload: result.listingPayload },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "next-listing failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
