import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { requeueListingForUser } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequeueBody = {
  listing_id?: unknown;
  listing_key?: unknown;
  store_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RequeueBody;
    const listingId = toTrimmed(body.listing_id);
    const listingKey = toTrimmed(body.listing_key);
    const storeId = toTrimmed(body.store_id);

    if (!storeId || (!listingId && !listingKey)) {
      return NextResponse.json({ error: "store_id ve listing_id/listing_key zorunludur." }, { status: 400 });
    }

    const row = await requeueListingForUser({
      userId: auth.user.id,
      targetClientId: storeId,
      listingId: listingId || null,
      listingKey: listingKey || null,
      reason: "extension_panel_manual_requeue",
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
