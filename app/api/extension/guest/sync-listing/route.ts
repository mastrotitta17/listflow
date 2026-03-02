import { NextRequest, NextResponse } from "next/server";
import { syncGuestListingPayload } from "@/lib/extension/listing-queue";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  client_id?: unknown;
  listing_payload?: unknown;
  source?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const clientId = toTrimmed(body.client_id);
    const listingPayload =
      body.listing_payload && typeof body.listing_payload === "object" && !Array.isArray(body.listing_payload)
        ? (body.listing_payload as Record<string, unknown>)
        : null;

    if (!clientId) {
      return NextResponse.json({ error: "client_id is required" }, { status: 400 });
    }

    if (!listingPayload) {
      return NextResponse.json({ error: "listing_payload is required" }, { status: 400 });
    }

    const result = await syncGuestListingPayload({
      clientId,
      listingPayload,
      source: toTrimmed(body.source) || null,
    });

    await supabaseAdmin.from("extension_logs").insert({
      user_id: null,
      store_id: clientId,
      store_name: null,
      level: result.ok ? "info" : "warn",
      event: "guest_listing_sync",
      message: result.ok ? "Guest listing payload synced to listing table." : "Guest listing payload sync failed.",
      metadata: {
        source: toTrimmed(body.source) || "guest",
        result,
      },
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.reason || "guest_listing_sync_failed",
          result,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        result,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "guest listing sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

