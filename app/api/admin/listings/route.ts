import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { deriveListingRuntimeStatus, resolveListingProofState } from "@/lib/extension/listing-proof";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;
type StoreLookupRow = {
  id: string;
  store_name?: string | null;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getClientId = (row: ListingRow) =>
  toTrimmed(row.client_id || row.store_id || row.clientId || "");

const loadStoreNameById = async (clientIds: string[]) => {
  const normalizedIds = Array.from(
    new Set(
      clientIds
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const map = new Map<string, string>();

  if (normalizedIds.length === 0) {
    return map;
  }

  const chunkSize = 500;
  for (let index = 0; index < normalizedIds.length; index += chunkSize) {
    const chunk = normalizedIds.slice(index, index + chunkSize);
    const query = await supabaseAdmin.from("stores").select("id, store_name").in("id", chunk);

    if (query.error) {
      continue;
    }

    for (const row of ((query.data ?? []) as StoreLookupRow[])) {
      const id = toTrimmed(row.id);
      const storeName = toTrimmed(row.store_name);
      if (id && storeName) {
        map.set(id, storeName);
      }
    }
  }

  return map;
};

const parseDateMs = (value: unknown) => {
  const text = toTrimmed(value);
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const getListingProofUrl = (row: ListingRow) => resolveListingProofState(row).listingUrl;

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

  const storeNameByClientId = await loadStoreNameById(loaded.rows.map((row) => getClientId(row)));

  const sorted = loaded.rows.sort((a, b) => {
    const aMs = parseDateMs(a.updated_at) ?? parseDateMs(a.created_at) ?? 0;
    const bMs = parseDateMs(b.updated_at) ?? parseDateMs(b.created_at) ?? 0;
    return bMs - aMs;
  });

  const filtered = sorted.filter((row) => {
    const clientId = getClientId(row);
    const derivedStoreName = storeNameByClientId.get(clientId) || "";
    const derived = deriveListingRuntimeStatus(row, row.status || row.listing_status || "");

    if (statusFilter && statusFilter !== "all") {
      const rowStatus = toTrimmed(derived.status).toLowerCase();
      if (statusFilter === "uploaded") {
        if (!derived.proof.hasValidProof) return false;
      } else if (statusFilter === "not_uploaded") {
        if (derived.proof.hasValidProof) return false;
      } else if (rowStatus !== statusFilter) {
        return false;
      }
    }

    if (clientFilter) {
      const normalizedFilter = clientFilter.toLowerCase();
      const clientIdMatches = clientId.toLowerCase().includes(normalizedFilter);
      const storeNameMatches = derivedStoreName.toLowerCase().includes(normalizedFilter);
      if (!clientIdMatches && !storeNameMatches) {
        return false;
      }
    }

    if (search) {
      const blob = [
        toTrimmed(row.id),
        toTrimmed(row.key),
        clientId,
        derivedStoreName,
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
  const mapped = page.map((row) => {
    const derived = deriveListingRuntimeStatus(row, row.status || row.listing_status || "");
    return {
      ...row,
      derived_status: derived.status || "-",
      is_uploaded: derived.proof.hasValidProof,
      manual_review: derived.manualReview,
      manual_review_reason: derived.manualReviewReason,
      derived_client_id: getClientId(row),
      derived_store_name: storeNameByClientId.get(getClientId(row)) || null,
      derived_listing_url: derived.proof.listingUrl || getListingProofUrl(row),
    };
  });

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
