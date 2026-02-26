import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { deriveEtsySelectorHints, maskPrimitivePayload, parseEtsyPageSyncInput } from "@/lib/extension/page-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const input = parseEtsyPageSyncInput(payload);
    const result = deriveEtsySelectorHints(input);

    return NextResponse.json(
      {
        ok: true,
        synced_at: input.synced_at,
        user_id: auth.user.id,
        ui_version: result.ui_version,
        confidence: result.confidence,
        selector_hints: result.hints,
        debug: result.debug,
        accepted_payload_preview: maskPrimitivePayload({
          page_url: input.page_url,
          path: input.path,
          selector_groups: Object.fromEntries(
            Object.entries(input.selector_groups).map(([key, rows]) => [key, rows.length])
          ),
          buttons_count: input.buttons.length,
        }),
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Etsy page sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
