import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level") || null;
  const storeName = searchParams.get("store_name") || null;
  const event = searchParams.get("event") || null;
  const offsetParam = parseInt(searchParams.get("offset") || "0", 10);
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

  let query = supabaseAdmin
    .from("extension_logs")
    .select("id, user_id, store_id, store_name, level, event, message, metadata, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (level && level !== "all") {
    query = query.eq("level", level);
  }
  if (storeName) {
    query = query.ilike("store_name", `%${storeName}%`);
  }
  if (event) {
    query = query.ilike("event", `%${event}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[admin/extension-logs] query error:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [], has_more: (data?.length ?? 0) === PAGE_SIZE });
}
