import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        user_id: auth.user.id,
        received_at: new Date().toISOString(),
        payload_type: payload && typeof payload === "object" ? "json" : "unknown",
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orders snapshot failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
