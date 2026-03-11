import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { requeueListingForClient } from "@/lib/extension/listing-queue";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequeueBody = {
  listing_id?: unknown;
  listing_key?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const body = (await request.json().catch(() => ({}))) as RequeueBody;
  const listingId = toTrimmed(body.listing_id);
  const listingKey = toTrimmed(body.listing_key);

  if (!listingId && !listingKey) {
    return NextResponse.json({ error: "listing_id or listing_key is required" }, { status: 400 });
  }

  const identifier = listingId
    ? ({ column: "id", value: listingId } as const)
    : ({ column: "key", value: listingKey } as const);

  const loaded = await supabaseAdmin
    .from("listing")
    .select("id, key, client_id")
    .eq(identifier.column, identifier.value)
    .maybeSingle<{ id?: string | null; key?: string | null; client_id?: string | null }>();

  if (loaded.error) {
    return NextResponse.json({ error: loaded.error.message || "Could not load listing" }, { status: 500 });
  }

  if (!loaded.data) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const clientId = toTrimmed(loaded.data.client_id);
  if (!clientId) {
    return NextResponse.json({ error: "Listing client_id bulunamadı" }, { status: 400 });
  }

  const updated = await requeueListingForClient({
    clientId,
    listingId: listingId || null,
    listingKey: listingKey || null,
    reason: "admin_manual_requeue",
  });

  if (!updated.reset) {
    return NextResponse.json(
      { error: updated.reason || "Listing tekrar sıraya alınamadı." },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      row: updated,
      message: "Listing yeniden kuyruğa alındı.",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
