import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;

type DeleteBody = {
  listing_id?: unknown;
  listing_key?: unknown;
  store_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

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

    const body = (await request.json().catch(() => ({}))) as DeleteBody;
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

    const deleted = await supabaseAdmin.from("listing").delete().eq(identifier.column, identifier.value);

    if (deleted.error) {
      return NextResponse.json({ error: deleted.error.message || "Could not delete listing" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Ürün sıradan kaldırıldı.",
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ürün silinemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
