import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;

type RequeueBody = {
  listing_id?: unknown;
  listing_key?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const buildRequeuePayload = (row: ListingRow) => {
  const payload: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();

  if (Object.prototype.hasOwnProperty.call(row, "status")) {
    payload.status = "pending";
  }
  if (Object.prototype.hasOwnProperty.call(row, "listing_status")) {
    payload.listing_status = "pending";
  }

  if (Object.prototype.hasOwnProperty.call(row, "updated_at")) {
    payload.updated_at = nowIso;
  }

  const clearColumns = [
    "processed_at",
    "completed_at",
    "claimed_at",
    "claimed_by_user_id",
    "claimed_by",
    "last_error",
    "error",
    "etsy_listing_id",
    "etsy_listing_url",
    "etsy_store_link",
  ];

  for (const column of clearColumns) {
    if (Object.prototype.hasOwnProperty.call(row, column)) {
      payload[column] = null;
    }
  }

  return payload;
};

const loadListing = async (identifier: { column: "id" | "key"; value: string }) => {
  const query = await supabaseAdmin
    .from("listing")
    .select("*")
    .eq(identifier.column, identifier.value)
    .maybeSingle<ListingRow>();

  if (query.error) {
    return { row: null as ListingRow | null, error: query.error.message || "Could not load listing" };
  }

  return { row: query.data ?? null, error: null as string | null };
};

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

  const loaded = await loadListing(identifier);
  if (loaded.error) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }

  if (!loaded.row) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const payload = buildRequeuePayload(loaded.row);
  const updated = await supabaseAdmin
    .from("listing")
    .update(payload)
    .eq(identifier.column, identifier.value)
    .select("*")
    .maybeSingle<ListingRow>();

  if (updated.error) {
    return NextResponse.json({ error: updated.error.message || "Could not requeue listing" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      row: updated.data ?? null,
      message: "Listing yeniden kuyruğa alındı.",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
