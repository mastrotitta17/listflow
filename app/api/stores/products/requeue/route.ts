import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;

type RequeueBody = {
  listing_id?: unknown;
  listing_key?: unknown;
  store_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const buildRequeuePayload = (row: ListingRow, storeId: string) => {
  const payload: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();

  if (Object.prototype.hasOwnProperty.call(row, "status")) {
    payload.status = "pending";
  }
  if (Object.prototype.hasOwnProperty.call(row, "listing_status")) {
    payload.listing_status = "pending";
  }
  if (Object.prototype.hasOwnProperty.call(row, "client_id")) {
    payload.client_id = storeId;
  }
  if (Object.prototype.hasOwnProperty.call(row, "updated_at")) {
    payload.updated_at = nowIso;
  }
  if (Object.prototype.hasOwnProperty.call(row, "manual_requeue_requested_at")) {
    payload.manual_requeue_requested_at = nowIso;
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
    "publish_proof",
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
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RequeueBody;
    const listingId = toTrimmed(body.listing_id);
    const listingKey = toTrimmed(body.listing_key);
    const storeId = toTrimmed(body.store_id);

    if (!storeId || (!listingId && !listingKey)) {
      return NextResponse.json({ error: "store_id ve listing_id/listing_key zorunludur." }, { status: 400 });
    }

    const ownedStore = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();

    if (ownedStore.error) {
      return NextResponse.json({ error: ownedStore.error.message }, { status: 500 });
    }

    if (!ownedStore.data) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
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

    const rowStoreId = toTrimmed(
      loaded.row.client_id ?? loaded.row.clientId ?? loaded.row.store_id ?? loaded.row.storeId
    );

    if (rowStoreId && rowStoreId !== storeId) {
      return NextResponse.json({ error: "Bu ürün seçili mağazaya ait değil." }, { status: 403 });
    }

    const payload = buildRequeuePayload(loaded.row, storeId);
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
        message: "Ürün tekrar sıraya alındı.",
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ürün tekrar sıraya alınamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
