import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { resetFailedListingForUser } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RetryBody = {
  listing_id?: unknown;
  listing_key?: unknown;
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
    const listingKey = toTrimmed(body.listing_key);
    if (!listingId && !listingKey) {
      return NextResponse.json({ error: "listing_id or listing_key required" }, { status: 400 });
    }

    const reset = await resetFailedListingForUser({
      userId: auth.user.id,
      listingId: listingId || null,
      listingKey: listingKey || null,
      reason: "extension_auto_retry",
    });

    if (!reset.reset) {
      return NextResponse.json(
        { error: reset.reason || "Could not retry listing", ...reset },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { ok: true, ...reset },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retry listing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
