import { NextRequest, NextResponse } from "next/server";
import { applyGuestListingJobReport } from "@/lib/extension/listing-queue";
import { reportGuestSheetUpload } from "@/lib/extension/guest-sheets";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  client_id?: unknown;
  status?: unknown;
  step?: unknown;
  listing_id?: unknown;
  listing_key?: unknown;
  sheet_row_id?: unknown;
  error?: unknown;
  etsy_refs?: {
    listing_id?: unknown;
    listing_url?: unknown;
  } | null;
  result?: {
    publish_proof?: unknown;
  } | null;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const resolveStatus = (body: Body) => {
  const rawStatus = toTrimmed(body.status).toLowerCase();
  if (rawStatus === "done" || rawStatus === "success" || rawStatus === "completed") {
    return "completed" as const;
  }
  if (rawStatus === "error" || rawStatus === "failed") {
    return "failed" as const;
  }

  const step = toTrimmed(body.step).toLowerCase();
  if (step.includes("done") || step.includes("success")) {
    return "completed" as const;
  }
  if (step.includes("error") || step.includes("failed")) {
    return "failed" as const;
  }

  return "processing" as const;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const clientId = toTrimmed(body.client_id);

    if (!clientId) {
      return NextResponse.json({ error: "client_id is required" }, { status: 400 });
    }

    const reportStatus = resolveStatus(body);
    const listingId = toTrimmed(body.listing_id) || toTrimmed(body.etsy_refs?.listing_id);
    const listingKey = toTrimmed(body.listing_key);
    const listingUrl = toTrimmed(body.etsy_refs?.listing_url);
    const sheetRowId = toTrimmed(body.sheet_row_id);
    const etsyListingId = toTrimmed(body.etsy_refs?.listing_id) || null;

    // Update listing table (existing flow — may not exist for sheets-only path)
    const listingResult = await applyGuestListingJobReport({
      clientId,
      listingId: listingId || null,
      listingKey: listingKey || null,
      status: reportStatus,
      error: toTrimmed(body.error) || null,
      etsyListingId,
      etsyListingUrl: listingUrl || null,
      publishProof: toTrimmed(body.result?.publish_proof) || null,
    });

    // Update guest_sheet_uploads table when sheet_row_id is present (sheets-based path)
    if (sheetRowId && (reportStatus === "completed" || reportStatus === "failed")) {
      await reportGuestSheetUpload({
        clientId,
        sheetRowId,
        status: reportStatus,
        error: toTrimmed(body.error) || null,
        etsyListingId,
        etsyListingUrl: listingUrl || null,
      });
    }

    await supabaseAdmin.from("extension_logs").insert({
      user_id: null,
      store_id: clientId,
      store_name: null,
      level: reportStatus === "failed" ? "error" : reportStatus === "completed" ? "info" : "warn",
      event:
        reportStatus === "failed"
          ? "guest_listing_upload_failed"
          : reportStatus === "completed"
            ? "guest_listing_upload_completed"
            : "guest_listing_upload_processing",
      message:
        reportStatus === "failed"
          ? "Client ID akışında ürün yükleme hata ile sonuçlandı."
          : reportStatus === "completed"
            ? "Client ID akışında ürün Etsy'ye başarıyla yüklendi."
            : "Client ID akışında ürün yükleme raporu alındı.",
      metadata: {
        report_status: reportStatus,
        listing_result: listingResult,
        listing_id: listingId || null,
        listing_key: listingKey || null,
        sheet_row_id: sheetRowId || null,
        client_id: clientId,
        error: toTrimmed(body.error) || null,
        etsy_listing_id: etsyListingId,
        etsy_listing_url: listingUrl || null,
        publish_proof: toTrimmed(body.result?.publish_proof) || null,
      },
    });

    // Return ok if either table was updated successfully
    const ok = listingResult.ok || Boolean(sheetRowId);

    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          error: listingResult.reason || "guest_report_failed",
          result: listingResult,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: true, result: listingResult },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "guest report failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
