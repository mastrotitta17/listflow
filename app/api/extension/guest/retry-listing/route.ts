import { NextRequest, NextResponse } from "next/server";
import { resetFailedListingForClient } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RetryBody = {
  client_id?: unknown;
  listing_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as RetryBody;
    const clientId = toTrimmed(body.client_id);
    const listingId = toTrimmed(body.listing_id);

    if (!clientId) {
      return NextResponse.json({ error: "client_id required" }, { status: 400 });
    }

    if (!listingId) {
      return NextResponse.json({ error: "listing_id required" }, { status: 400 });
    }

    const reset = await resetFailedListingForClient({
      clientId,
      listingId,
      reason: "extension_auto_retry",
    });

    return NextResponse.json(
      { ok: true, reset },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retry guest listing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
