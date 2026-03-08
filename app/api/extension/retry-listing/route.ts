import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { resetFailedListingForUser } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RetryBody = {
  listing_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RetryBody;
    const listingId = toTrimmed(body.listing_id);
    if (!listingId) {
      return NextResponse.json({ error: "listing_id required" }, { status: 400 });
    }

    const reset = await resetFailedListingForUser({
      userId: auth.user.id,
      listingId,
      reason: "extension_auto_retry",
    });

    return NextResponse.json(
      { ok: true, reset },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retry listing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
