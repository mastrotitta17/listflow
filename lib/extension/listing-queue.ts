import { supabaseAdmin } from "@/lib/supabase/admin";

type RowRecord = Record<string, unknown>;

type ListingIdentifier =
  | {
      column: "id";
      value: string;
    }
  | {
      column: "key";
      value: string;
    };

type ClaimArgs = {
  userId: string;
  preferredClientId?: string | null;
};

type ClaimResult = {
  listing: RowRecord;
  identifier: ListingIdentifier | null;
  listingPayload: RowRecord;
};

const PENDING_STATUSES = new Set(["", "pending", "queued", "ready", "new", "draft", "todo"]);

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return "";
  }

  return value.trim();
};

const normalizeStatus = (value: unknown) => normalizeString(value).toLowerCase();

const readFirstString = (row: RowRecord, keys: string[]) => {
  for (const key of keys) {
    const value = normalizeString(row[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const readFirstNumber = (row: RowRecord, keys: string[]) => {
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }

    const asText = normalizeString(raw);
    if (!asText) {
      continue;
    }

    const maybe = Number(asText.replace(",", "."));
    if (Number.isFinite(maybe)) {
      return maybe;
    }
  }
  return null;
};

const parseDateMs = (value: unknown) => {
  const text = normalizeString(value);
  if (!text) {
    return null;
  }

  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const sortByOldestFirst = (a: RowRecord, b: RowRecord) => {
  const aMs =
    parseDateMs(a.created_at) ??
    parseDateMs(a.DATE) ??
    parseDateMs(a.date) ??
    parseDateMs(a.updated_at) ??
    Number.MAX_SAFE_INTEGER;
  const bMs =
    parseDateMs(b.created_at) ??
    parseDateMs(b.DATE) ??
    parseDateMs(b.date) ??
    parseDateMs(b.updated_at) ??
    Number.MAX_SAFE_INTEGER;

  if (aMs !== bMs) {
    return aMs - bMs;
  }

  const aId = readFirstString(a, ["id", "key"]) ?? "";
  const bId = readFirstString(b, ["id", "key"]) ?? "";
  return aId.localeCompare(bId);
};

const inferIdentifier = (row: RowRecord): ListingIdentifier | null => {
  const id = readFirstString(row, ["id"]);
  if (id) {
    return { column: "id", value: id };
  }

  const key = readFirstString(row, ["key"]);
  if (key) {
    return { column: "key", value: key };
  }

  return null;
};

const readClientId = (row: RowRecord) => readFirstString(row, ["client_id", "clientId", "store_id"]);

const readUserId = (row: RowRecord) => readFirstString(row, ["user_id", "owner_user_id"]);

const inferStatusFieldName = (row: RowRecord) => {
  if (Object.prototype.hasOwnProperty.call(row, "status")) {
    return "status";
  }
  if (Object.prototype.hasOwnProperty.call(row, "listing_status")) {
    return "listing_status";
  }
  return null;
};

const isRowPending = (row: RowRecord) => {
  const statusField = inferStatusFieldName(row);
  if (!statusField) {
    return true;
  }

  const status = normalizeStatus(row[statusField]);
  return PENDING_STATUSES.has(status);
};

const addIfPresent = (row: RowRecord, key: string, value: unknown, target: RowRecord) => {
  if (Object.prototype.hasOwnProperty.call(row, key)) {
    target[key] = value;
  }
};

const buildUpdatePayloadForClaim = (row: RowRecord, userId: string) => {
  const nowIso = new Date().toISOString();
  const payload: RowRecord = {};
  const statusField = inferStatusFieldName(row);
  if (statusField) {
    payload[statusField] = "processing";
  }

  addIfPresent(row, "updated_at", nowIso, payload);
  addIfPresent(row, "claimed_at", nowIso, payload);
  addIfPresent(row, "claimed_by_user_id", userId, payload);
  addIfPresent(row, "claimed_by", userId, payload);
  addIfPresent(row, "last_error", null, payload);
  addIfPresent(row, "error", null, payload);

  return payload;
};

const buildUpdatePayloadForReport = (
  row: RowRecord,
  args: {
    status: "processing" | "completed" | "failed";
    error?: string | null;
    etsyListingId?: string | null;
    etsyListingUrl?: string | null;
  }
) => {
  const nowIso = new Date().toISOString();
  const payload: RowRecord = {};
  const statusField = inferStatusFieldName(row);
  if (statusField) {
    payload[statusField] = args.status;
  }

  addIfPresent(row, "updated_at", nowIso, payload);
  addIfPresent(row, "processed_at", nowIso, payload);
  addIfPresent(row, "completed_at", args.status === "completed" ? nowIso : row.completed_at, payload);
  addIfPresent(row, "last_error", args.error ?? null, payload);
  addIfPresent(row, "error", args.error ?? null, payload);
  addIfPresent(row, "etsy_listing_id", args.etsyListingId ?? row.etsy_listing_id ?? null, payload);
  addIfPresent(row, "etsy_listing_url", args.etsyListingUrl ?? row.etsy_listing_url ?? null, payload);
  addIfPresent(row, "etsy_store_link", args.etsyListingUrl ?? row.etsy_store_link ?? null, payload);

  return payload;
};

const parseVariations = (value: unknown) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const mapListingPayload = (row: RowRecord): RowRecord => {
  const title = readFirstString(row, ["title", "name"]) ?? "";
  const description = readFirstString(row, ["description", "catalog_description"]) ?? "";
  const tags = readFirstString(row, ["tags", "etiket"]) ?? "";
  const category = readFirstString(row, ["category", "category_name"]) ?? "";

  const payload: RowRecord = {
    listing_id: readFirstString(row, ["id"]),
    listing_key: readFirstString(row, ["key"]),
    client_id: readClientId(row),
    title,
    description,
    tags,
    category,
    price: readFirstNumber(row, ["price", "sale_price", "amount_usd"]) ?? 0,
    quantity: readFirstNumber(row, ["quantity"]) ?? 1,
    image_1_url: readFirstString(row, ["image_1_url"]),
    image_2_url: readFirstString(row, ["image_2_url"]),
    image_3_url: readFirstString(row, ["image_3_url"]),
    image_1_base64: readFirstString(row, ["image_1_base64"]),
    image_2_base64: readFirstString(row, ["image_2_base64"]),
    image_3_base64: readFirstString(row, ["image_3_base64"]),
    etsy_store_link: readFirstString(row, ["etsy_store_link"]),
    variations: parseVariations(row.variations),
  };

  if (row.shipping_template && typeof row.shipping_template === "object") {
    payload.shipping_template = row.shipping_template;
  }

  return payload;
};

const loadAllListingRows = async () => {
  const query = await supabaseAdmin.from("listing").select("*").limit(2000);
  if (query.error) {
    throw new Error(query.error.message || "listing table query failed");
  }
  return ((query.data ?? []) as RowRecord[]) ?? [];
};

const loadStoreIdsByUser = async (userId: string) => {
  const query = await supabaseAdmin.from("stores").select("id").eq("user_id", userId).limit(2000);
  if (query.error) {
    return [];
  }

  return ((query.data ?? []) as Array<{ id?: string | null }>)
    .map((row) => normalizeString(row.id))
    .filter(Boolean);
};

const canUserUseClientId = async (userId: string, candidateClientId: string) => {
  const storeIds = await loadStoreIdsByUser(userId);
  if (storeIds.length === 0) {
    return false;
  }
  return storeIds.includes(candidateClientId);
};

const rowBelongsToUser = (
  row: RowRecord,
  args: {
    userId: string;
    allowedClientIds: Set<string>;
  }
) => {
  const rowUserId = readUserId(row);
  if (rowUserId && rowUserId === args.userId) {
    return true;
  }

  const rowClientId = readClientId(row);
  if (rowClientId && args.allowedClientIds.has(rowClientId)) {
    return true;
  }

  return false;
};

const updateRowByIdentifier = async (identifier: ListingIdentifier, payload: RowRecord) => {
  if (!payload || Object.keys(payload).length === 0) {
    return;
  }

  const query = await supabaseAdmin.from("listing").update(payload).eq(identifier.column, identifier.value);
  if (query.error) {
    throw new Error(query.error.message || "listing update failed");
  }
};

export const claimNextListingForUser = async (args: ClaimArgs): Promise<ClaimResult | null> => {
  const preferredClientId = normalizeString(args.preferredClientId);
  if (preferredClientId) {
    const allowed = await canUserUseClientId(args.userId, preferredClientId);
    if (!allowed) {
      return null;
    }
  }

  const userStoreIds = await loadStoreIdsByUser(args.userId);
  const allowedClientIds = new Set<string>(preferredClientId ? [preferredClientId] : userStoreIds);
  const rows = await loadAllListingRows();

  const eligibleRows = rows
    .filter((row) => rowBelongsToUser(row, { userId: args.userId, allowedClientIds }))
    .filter((row) => {
      if (preferredClientId) {
        return readClientId(row) === preferredClientId;
      }
      return true;
    })
    .filter(isRowPending)
    .sort(sortByOldestFirst);

  const listing = eligibleRows[0] ?? null;
  if (!listing) {
    return null;
  }

  const identifier = inferIdentifier(listing);
  if (identifier) {
    const claimPayload = buildUpdatePayloadForClaim(listing, args.userId);
    await updateRowByIdentifier(identifier, claimPayload);
  }

  return {
    listing,
    identifier,
    listingPayload: mapListingPayload(listing),
  };
};

type ReportArgs = {
  userId: string;
  listingId?: string | null;
  listingKey?: string | null;
  status: "processing" | "completed" | "failed";
  error?: string | null;
  etsyListingId?: string | null;
  etsyListingUrl?: string | null;
};

const loadListingByIdentifier = async (identifier: ListingIdentifier) => {
  const query = await supabaseAdmin
    .from("listing")
    .select("*")
    .eq(identifier.column, identifier.value)
    .maybeSingle<RowRecord>();
  if (query.error) {
    throw new Error(query.error.message || "listing lookup failed");
  }
  return query.data ?? null;
};

const resolveIdentifierFromArgs = (args: ReportArgs): ListingIdentifier | null => {
  const listingId = normalizeString(args.listingId);
  if (listingId) {
    return {
      column: "id",
      value: listingId,
    };
  }

  const listingKey = normalizeString(args.listingKey);
  if (listingKey) {
    return {
      column: "key",
      value: listingKey,
    };
  }

  return null;
};

export const applyListingJobReport = async (args: ReportArgs) => {
  const identifier = resolveIdentifierFromArgs(args);
  if (!identifier) {
    return { ok: false, reason: "identifier_missing" as const };
  }

  const row = await loadListingByIdentifier(identifier);
  if (!row) {
    return { ok: false, reason: "listing_not_found" as const };
  }

  const userStoreIds = await loadStoreIdsByUser(args.userId);
  const allowedClientIds = new Set<string>(userStoreIds);
  const belongs = rowBelongsToUser(row, {
    userId: args.userId,
    allowedClientIds,
  });

  if (!belongs) {
    return { ok: false, reason: "not_owner" as const };
  }

  const payload = buildUpdatePayloadForReport(row, {
    status: args.status,
    error: args.error ?? null,
    etsyListingId: normalizeString(args.etsyListingId) || null,
    etsyListingUrl: normalizeString(args.etsyListingUrl) || null,
  });

  await updateRowByIdentifier(identifier, payload);
  return { ok: true as const };
};
