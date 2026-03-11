import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { requeueListingForClient } from "@/lib/extension/listing-queue";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtensionLogRow = {
  id: string;
  store_id: string | null;
  metadata: Record<string, unknown> | null;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const pickFirstString = (...values: unknown[]) => {
  for (const value of values) {
    const text = toTrimmed(value);
    if (text) return text;
  }
  return "";
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
    if ((listingId || listingKey) && clientId) {
      const requeued = await requeueListingForClient({
        clientId,
        listingId: listingId || null,
        listingKey: listingKey || null,
        reason: "admin_extension_log_requeue",
      });

      if (!requeued.reset) {
        return NextResponse.json(
          { error: requeued.reason || "Could not requeue listing" },
          { status: 409 }
        );
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
