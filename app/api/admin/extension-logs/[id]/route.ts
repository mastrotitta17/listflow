import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtensionLogRow = {
  id: string;
  store_id: string | null;
  metadata: Record<string, unknown> | null;
};

type ListingRow = Record<string, unknown>;

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const pickFirstString = (...values: unknown[]) => {
  for (const value of values) {
    const text = toTrimmed(value);
    if (text) return text;
  }
  return "";
};

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

const loadListingByIdentity = async (listingId: string, listingKey: string) => {
  if (listingId) {
    const byId = await supabaseAdmin.from("listing").select("*").eq("id", listingId).maybeSingle<ListingRow>();
    if (!byId.error && byId.data) {
      return { row: byId.data, identity: { column: "id" as const, value: listingId } };
    }
  }

  if (listingKey) {
    const byKey = await supabaseAdmin.from("listing").select("*").eq("key", listingKey).maybeSingle<ListingRow>();
    if (!byKey.error && byKey.data) {
      return { row: byKey.data, identity: { column: "key" as const, value: listingKey } };
    }
  }

  return { row: null, identity: null };
};

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const params = await context.params;
  const logId = toTrimmed(params.id);
  if (!logId) {
    return NextResponse.json({ error: "log id is required" }, { status: 400 });
  }

  const requeue = request.nextUrl.searchParams.get("requeue") === "true";

  const loadedLog = await supabaseAdmin
    .from("extension_logs")
    .select("id, store_id, metadata")
    .eq("id", logId)
    .maybeSingle<ExtensionLogRow>();

  if (loadedLog.error) {
    return NextResponse.json({ error: loadedLog.error.message || "Could not load log" }, { status: 500 });
  }
  if (!loadedLog.data) {
    return NextResponse.json({ error: "Log not found" }, { status: 404 });
  }

  const metadata = loadedLog.data.metadata && typeof loadedLog.data.metadata === "object" ? loadedLog.data.metadata : {};

  const listingId = pickFirstString(
    metadata["listing_id"],
    (metadata["etsy_refs"] as Record<string, unknown> | null)?.listing_id
  );
  const listingKey = pickFirstString(metadata["listing_key"]);
  const sheetRowId = pickFirstString(metadata["sheet_row_id"]);
  const clientId = pickFirstString(metadata["client_id"], loadedLog.data.store_id);

  let listingRequeued = false;
  let guestRowReset = false;

  if (requeue) {
    const listingLoaded = await loadListingByIdentity(listingId, listingKey);
    if (listingLoaded.row && listingLoaded.identity) {
      const payload = buildRequeuePayload(listingLoaded.row);
      const updated = await supabaseAdmin
        .from("listing")
        .update(payload)
        .eq(listingLoaded.identity.column, listingLoaded.identity.value);

      if (updated.error) {
        return NextResponse.json({ error: updated.error.message || "Could not requeue listing" }, { status: 500 });
      }
      listingRequeued = true;
    }

    if (sheetRowId && clientId) {
      const deletedGuestSheet = await supabaseAdmin
        .from("guest_sheet_uploads")
        .delete()
        .eq("client_id", clientId)
        .eq("sheet_row_id", sheetRowId);

      if (deletedGuestSheet.error) {
        return NextResponse.json(
          { error: deletedGuestSheet.error.message || "Could not reset guest sheet row" },
          { status: 500 }
        );
      }
      guestRowReset = true;
    }
  }

  const deletedLog = await supabaseAdmin.from("extension_logs").delete().eq("id", logId);
  if (deletedLog.error) {
    return NextResponse.json({ error: deletedLog.error.message || "Could not delete log" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      deleted_log_id: logId,
      requeue_requested: requeue,
      listing_requeued: listingRequeued,
      guest_sheet_reset: guestRowReset,
      listing_id: listingId || null,
      listing_key: listingKey || null,
      sheet_row_id: sheetRowId || null,
      client_id: clientId || null,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}

