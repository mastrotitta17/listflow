import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeStatus = (row: ListingRow) =>
  toTrimmed(row.status || row.listing_status || "").toLowerCase();

const getClientId = (row: ListingRow) =>
  toTrimmed(row.client_id || row.store_id || row.clientId || "");

const parseDateMs = (value: unknown) => {
  const text = toTrimmed(value);
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const getListingProofUrl = (row: ListingRow) =>
  toTrimmed(row.etsy_listing_url || row.etsy_store_link || "");

const isUploaded = (row: ListingRow) => {
  const completedAt = parseDateMs(row.completed_at);
  const listingId = toTrimmed(row.etsy_listing_id || "");
  const listingUrl = getListingProofUrl(row);
  const hasUrlProof = Boolean(listingUrl && !/\/listing-editor\//i.test(listingUrl));
  return Boolean(completedAt || listingId || hasUrlProof);
};

const listRows = async () => {
  const pageSize = 1000;
  const maxRows = 12000;
  const rows: ListingRow[] = [];
  let from = 0;

  while (rows.length < maxRows) {
    const to = from + pageSize - 1;
    const query = await supabaseAdmin.from("listing").select("*").range(from, to);

    if (query.error) {
      return { rows: [] as ListingRow[], error: query.error.message || "Could not query listing table" };
    }

    const page = ((query.data ?? []) as ListingRow[]) || [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return { rows, error: null as string | null };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const params = request.nextUrl.searchParams;
  const statusFilter = toTrimmed(params.get("status") || "").toLowerCase();
  const clientFilter = toTrimmed(params.get("client_id") || "");
  const search = toTrimmed(params.get("q") || "").toLowerCase();

  const limit = Math.min(500, Math.max(1, Number(params.get("limit") || 200)));
  const offset = Math.max(0, Number(params.get("offset") || 0));

  const loaded = await listRows();
  if (loaded.error) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }

  const sorted = loaded.rows.sort((a, b) => {
    const aMs = parseDateMs(a.updated_at) ?? parseDateMs(a.created_at) ?? 0;
    const bMs = parseDateMs(b.updated_at) ?? parseDateMs(b.created_at) ?? 0;
    return bMs - aMs;
  });

  const filtered = sorted.filter((row) => {
    if (statusFilter && statusFilter !== "all") {
      const rowStatus = normalizeStatus(row);
      if (statusFilter === "uploaded") {
        if (!isUploaded(row)) return false;
      } else if (statusFilter === "not_uploaded") {
        if (isUploaded(row)) return false;
      } else if (rowStatus !== statusFilter) {
        return false;
      }
    }

    if (clientFilter) {
      const clientId = getClientId(row);
      if (clientId !== clientFilter) {
        return false;
      }
    }

    if (search) {
      const blob = [
        toTrimmed(row.id),
        toTrimmed(row.key),
        getClientId(row),
        toTrimmed(row.title),
        toTrimmed(row.etsy_listing_id),
        getListingProofUrl(row),
      ]
        .join(" ")
        .toLowerCase();

      if (!blob.includes(search)) {
        return false;
      }
    }

    return true;
  });

  const page = filtered.slice(offset, offset + limit);
  const mapped = page.map((row) => ({
    ...row,
    derived_status: normalizeStatus(row) || "-",
    is_uploaded: isUploaded(row),
    derived_client_id: getClientId(row),
    derived_listing_url: getListingProofUrl(row),
  }));

  return NextResponse.json(
    {
      rows: mapped,
      total: filtered.length,
      has_more: offset + limit < filtered.length,
      limit,
      offset,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
