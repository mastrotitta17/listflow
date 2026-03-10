import { NextRequest, NextResponse } from "next/server";
import { requeueListingForClient } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequeueBody = {
  client_id?: unknown;
  listing_id?: unknown;
  listing_key?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as RequeueBody;
    const clientId = toTrimmed(body.client_id);
    const listingId = toTrimmed(body.listing_id);
    const listingKey = toTrimmed(body.listing_key);

    if (!clientId || (!listingId && !listingKey)) {
      return NextResponse.json({ error: "client_id ve listing_id/listing_key zorunludur." }, { status: 400 });
    }

    const row = await requeueListingForClient({
      clientId,
      listingId: listingId || null,
      listingKey: listingKey || null,
      reason: "extension_panel_guest_manual_requeue",
    });

    return NextResponse.json(
      { ok: true, row },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not requeue listing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
