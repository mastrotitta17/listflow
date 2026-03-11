import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { isStoreCategoryMismatch } from "@/lib/extension/listing-category-guard";
import { resolveListingProofState } from "@/lib/extension/listing-proof";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListingRow = Record<string, unknown>;
type StoreLookupRow = {
  id: string;
  store_name?: string | null;
  category?: string | null;
};

const RECONCILE_PROCESSING_LEASE_TTL_MS = 30 * 60 * 1000;

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getClientId = (row: ListingRow) =>
  toTrimmed(row.client_id || row.store_id || row.clientId || "");

const parseDateMs = (value: unknown) => {
  const text = toTrimmed(value);
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const loadStoreInfoById = async (clientIds: string[]) => {
  const normalizedIds = Array.from(new Set(clientIds.map((value) => value.trim()).filter(Boolean)));
  const map = new Map<string, { storeName: string; category: string | null }>();

  if (!normalizedIds.length) {
    return map;
  }

  const candidates = ["id, store_name, category", "id, store_name"] as const;
  const chunkSize = 500;

  for (let from = 0; from < normalizedIds.length; from += chunkSize) {
    const chunk = normalizedIds.slice(from, from + chunkSize);

    for (const select of candidates) {
      const query = await supabaseAdmin.from("stores").select(select).in("id", chunk);

      if (query.error) {
        const message = (query.error.message ?? "").toLowerCase();
        if (message.includes("column")) {
          continue;
        }
        throw new Error(query.error.message);
      }

      for (const row of (((query.data ?? []) as unknown) as StoreLookupRow[])) {
        const id = toTrimmed(row.id);
        if (!id) continue;
        map.set(id, {
          storeName: toTrimmed(row.store_name) || id,
          category: toTrimmed(row.category) || null,
        });
      }
      break;
    }
  }

  return map;
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
      throw new Error(query.error.message || "Could not query listing table");
    }

    const page = ((query.data ?? []) as ListingRow[]) || [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
};

const buildUpdatePayload = (row: ListingRow, reason: string) => {
  const payload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(row, "status")) {
    payload.status = "manual_review";
  }
  if (Object.prototype.hasOwnProperty.call(row, "listing_status")) {
    payload.listing_status = "manual_review";
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_at")) {
    payload.claimed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_by_user_id")) {
    payload.claimed_by_user_id = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_by")) {
    payload.claimed_by = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "processed_at")) {
    payload.processed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "completed_at")) {
    payload.completed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "error")) {
    payload.error = reason;
  }
  if (Object.prototype.hasOwnProperty.call(row, "last_error")) {
    payload.last_error = reason;
  }
  if (Object.prototype.hasOwnProperty.call(row, "updated_at")) {
    payload.updated_at = new Date().toISOString();
  }

  return payload;
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const rows = await listRows();
    const storeInfoByClientId = await loadStoreInfoById(rows.map((row) => getClientId(row)));

    let scanned = 0;
    let mismatchMarked = 0;
    let staleProcessingMarked = 0;
    const updatedIds: string[] = [];

    for (const row of rows) {
      scanned += 1;
      const rowId = toTrimmed(row.id);
      if (!rowId) continue;

      const clientId = getClientId(row);
      const storeInfo = storeInfoByClientId.get(clientId) || null;
      const proof = resolveListingProofState(row);
      const statusText = toTrimmed(row.status || row.listing_status).toLowerCase();

      const categoryMismatch = isStoreCategoryMismatch({
        storeCategory: storeInfo?.category ?? null,
        listingCategory: toTrimmed(row.category),
      });

      const updatedAtMs =
        parseDateMs(row.claimed_at) ??
        parseDateMs(row.updated_at) ??
        parseDateMs(row.processed_at) ??
        parseDateMs(row.created_at) ??
        0;
      const staleProcessing =
        statusText === "processing" &&
        !proof.hasValidProof &&
        Number.isFinite(updatedAtMs) &&
        updatedAtMs > 0 &&
        Date.now() - updatedAtMs > RECONCILE_PROCESSING_LEASE_TTL_MS;

      let reason: string | null = null;
      if (categoryMismatch && !proof.hasValidProof) {
        reason = "store_category_mismatch";
      } else if (staleProcessing) {
        reason = "stale_processing_without_publish_proof";
      }

      if (!reason) {
        continue;
      }

      const payload = buildUpdatePayload(row, reason);
      if (!Object.keys(payload).length) {
        continue;
      }

      const update = await supabaseAdmin.from("listing").update(payload).eq("id", rowId);
      if (update.error) {
        throw new Error(update.error.message);
      }

      updatedIds.push(rowId);
      if (reason === "store_category_mismatch") {
        mismatchMarked += 1;
      } else if (reason === "stale_processing_without_publish_proof") {
        staleProcessingMarked += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      updated: updatedIds.length,
      mismatch_marked: mismatchMarked,
      stale_processing_marked: staleProcessingMarked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Listing bakım işlemi başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
