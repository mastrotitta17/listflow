import { supabaseAdmin } from "@/lib/supabase/admin";

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/13y03EveZ34w7RiycbzXUGgpvRWfUovUmnx8IB-ZZ3E4/export?format=csv&gid=0";

const FETCH_TIMEOUT_MS = 20000;
// If a row has been "processing" for longer than this, treat it as eligible for retry
const PROCESSING_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields with embedded commas and newlines
// ---------------------------------------------------------------------------
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
      } else if (ch === "\r" && text[i + 1] === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i += 2;
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

type SheetRow = Record<string, string>;

const csvToObjects = (rows: string[][]): SheetRow[] => {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: SheetRow = {};
    headers.forEach((header, idx) => {
      obj[header] = (cells[idx] ?? "").trim();
    });
    return obj;
  });
};

// ---------------------------------------------------------------------------
// Fetch & parse the public sheet
// ---------------------------------------------------------------------------
const fetchSheetRows = async (): Promise<SheetRow[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SHEET_CSV_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
    const text = await res.text();
    const rows = parseCsv(text);
    return csvToObjects(rows);
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------
const SHEET_DONE_STATUSES = new Set(["completed", "done", "published"]);

// Returns set of sheet_row_ids that should be excluded (completed OR recently processing)
const loadExcludedSheetIds = async (clientId: string): Promise<Set<string>> => {
  const { data } = await supabaseAdmin
    .from("guest_sheet_uploads")
    .select("sheet_row_id, status, claimed_at")
    .eq("client_id", clientId)
    .in("status", ["completed", "processing"]);

  const ids = new Set<string>();
  const now = Date.now();

  for (const row of data ?? []) {
    if (!row.sheet_row_id) continue;
    if (row.status === "completed") {
      ids.add(String(row.sheet_row_id));
    } else if (row.status === "processing") {
      const claimedAt = row.claimed_at ? new Date(row.claimed_at).getTime() : 0;
      // Only exclude if claimed recently; stale processing rows are eligible for retry
      if (now - claimedAt < PROCESSING_TTL_MS) {
        ids.add(String(row.sheet_row_id));
      }
    }
  }

  return ids;
};

const claimSheetRow = async (clientId: string, sheetRowId: string) => {
  const nowIso = new Date().toISOString();
  await supabaseAdmin.from("guest_sheet_uploads").upsert(
    {
      client_id: clientId,
      sheet_row_id: sheetRowId,
      status: "processing",
      claimed_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "client_id,sheet_row_id" }
  );
};

// Also insert into the listing table so report-job can find it
const syncRowToListingTable = async (row: SheetRow, clientId: string) => {
  const nowIso = new Date().toISOString();
  const payload = {
    id: row["id"] || undefined,
    key: row["key"] || undefined,
    client_id: clientId,
    store_id: clientId,
    title: row["title"] || "",
    description: row["description"] || "",
    category: row["category"] || "",
    tags: row["tags"] ? row["tags"].split(",").map((t) => t.trim()).filter(Boolean).slice(0, 13) : [],
    price: parseFloat(row["price"] || "0") || 0,
    quantity: parseInt(row["quantity"] || "1", 10) || 1,
    image_1_url: row["image_1_url"] || null,
    image_2_url: row["image_2_url"] || null,
    image_3_url: row["image_3_url"] || null,
    status: "processing",
    listing_status: "processing",
    claimed_at: nowIso,
    claimed_by_user_id: null,
    claimed_by: null,
    updated_at: nowIso,
    created_at: nowIso,
  };

  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== "")
  );

  // Try insert; if duplicate (row already exists), update status to processing
  const result = await supabaseAdmin.from("listing").upsert(cleaned, { onConflict: "id" });
  if (result.error && result.error.code !== "23505") {
    // Non-critical: log but don't throw — guest_sheet_uploads is the source of truth
    console.error("[guest-sheets] listing upsert failed:", result.error.message);
  }
};

// ---------------------------------------------------------------------------
// Map a sheet row to listing payload
// ---------------------------------------------------------------------------
const mapRow = (row: SheetRow, sheetRowId: string) => ({
  listing_id: row["id"] || null,
  listing_key: row["key"] || null,
  client_id: row["client_id"] || null,
  title: row["title"] || "",
  description: row["description"] || "",
  tags: row["tags"]
    ? row["tags"].split(",").map((t) => t.trim()).filter(Boolean).slice(0, 13)
    : [],
  category: row["category"] || "",
  price: parseFloat(row["price"] || "0") || 0,
  quantity: parseInt(row["quantity"] || "1", 10) || 1,
  image_1_url: row["image_1_url"] || null,
  image_2_url: row["image_2_url"] || null,
  image_3_url: row["image_3_url"] || null,
  etsy_store_link: row["etsy_store_link"] || null,
  variations: row["variations"]
    ? (() => { try { return JSON.parse(row["variations"]); } catch { return []; } })()
    : [],
  _sheet_row_id: sheetRowId, // passed through for report-job
});

// ---------------------------------------------------------------------------
// Main export: claim next uncompleted listing for a client
// ---------------------------------------------------------------------------
export const claimNextGuestSheetListing = async (clientId: string) => {
  const trimmedClientId = clientId.trim();
  if (!trimmedClientId) return null;

  const [allRows, excludedIds] = await Promise.all([
    fetchSheetRows(),
    loadExcludedSheetIds(trimmedClientId),
  ]);

  const eligible = allRows.filter((row) => {
    if (row["client_id"] !== trimmedClientId) return false;
    const rowId = row["id"];
    if (!rowId) return false;
    if (excludedIds.has(rowId)) return false;
    // Skip rows marked as done in the sheet itself
    const sheetStatus = (row["status"] || "").toLowerCase();
    if (SHEET_DONE_STATUSES.has(sheetStatus)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  const chosen = eligible[0];
  const rowId = chosen["id"];

  // Mark as processing in both tables (parallel, non-blocking on listing table failure)
  await Promise.all([
    claimSheetRow(trimmedClientId, rowId),
    syncRowToListingTable(chosen, trimmedClientId),
  ]);

  return {
    sheetRowId: rowId,
    listingPayload: mapRow(chosen, rowId),
  };
};

// ---------------------------------------------------------------------------
// Update result after Etsy upload (called from report-job route)
// ---------------------------------------------------------------------------
export const reportGuestSheetUpload = async (args: {
  clientId: string;
  sheetRowId: string;
  status: "completed" | "failed";
  error?: string | null;
  etsyListingId?: string | null;
  etsyListingUrl?: string | null;
}) => {
  const nowIso = new Date().toISOString();
  await supabaseAdmin.from("guest_sheet_uploads").upsert(
    {
      client_id: args.clientId,
      sheet_row_id: args.sheetRowId,
      status: args.status,
      error: args.error ?? null,
      etsy_listing_id: args.etsyListingId ?? null,
      etsy_listing_url: args.etsyListingUrl ?? null,
      updated_at: nowIso,
      completed_at: args.status === "completed" ? nowIso : null,
    },
    { onConflict: "client_id,sheet_row_id" }
  );
};
