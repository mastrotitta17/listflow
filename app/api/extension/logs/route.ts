import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEVELS = new Set(["info", "warn", "error"]);

type LogBody = {
  store_id?: unknown;
  store_name?: unknown;
  level?: unknown;
  event?: unknown;
  message?: unknown;
  metadata?: unknown;
};

const toStr = (v: unknown, max = 500) => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as LogBody;

    const level = VALID_LEVELS.has(String(body.level || "")) ? String(body.level) : "info";
    const event = toStr(body.event, 200);
    if (!event) {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : null;

    const { error } = await supabaseAdmin.from("extension_logs").insert({
      user_id: auth.user.id,
      store_id: toStr(body.store_id, 200),
      store_name: toStr(body.store_name, 200),
      level,
      event,
      message: toStr(body.message, 2000),
      metadata: metadata as Record<string, unknown> | null,
    });

    if (error) {
      console.error("[extension/logs] insert error:", error.message);
      return NextResponse.json({ error: "Failed to save log" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
