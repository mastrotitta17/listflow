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
  forceRecover?: boolean;
};

type ClaimResult = {
  listing: RowRecord;
  identifier: ListingIdentifier | null;
  listingPayload: RowRecord;
};

const PENDING_STATUSES = new Set([
  "",
  "pending",
  "queued",
  "ready",
  "new",
  "draft",
  "todo",
]);
const STALE_PROCESSING_TTL_MS = 60 * 1000;
const SELF_RETRY_PROCESSING_TTL_MS = 3 * 1000;
const STUCK_PROCESSING_FORCE_RECOVER_MS = 2 * 60 * 1000;
const ORPHAN_PROCESSING_RECOVER_MS = 30 * 1000;

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

const readFirstValue = (row: RowRecord, keys: string[]) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      continue;
    }
    const value = row[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    return value;
  }
  return null;
};

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

const hasRowCompletionProof = (row: RowRecord) => {
  const listingId = readFirstString(row, ["etsy_listing_id"]);
  const listingUrl = readFirstString(row, ["etsy_listing_url", "etsy_store_link"]);
  const completedAt = parseDateMs(row.completed_at);
  const hasUrlProof = Boolean(listingUrl && !/\/listing-editor\//i.test(listingUrl));
  const hasIdProof = Boolean(listingId);
  return Boolean(completedAt || hasIdProof || hasUrlProof);
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

const isRowPending = (row: RowRecord, options: { userId?: string } = {}) => {
  if (hasRowCompletionProof(row)) {
    return false;
  }

  const statusField = inferStatusFieldName(row);
  if (!statusField) {
    return true;
  }

  const status = normalizeStatus(row[statusField]);
  if (PENDING_STATUSES.has(status)) {
    return true;
  }

  if (status === "processing") {
    const rowClaimedByUserId = readFirstString(row, ["claimed_by_user_id", "claimed_by"]);
    const claimedAt =
      parseDateMs(row.claimed_at) ??
      parseDateMs(row.updated_at) ??
      parseDateMs(row.processed_at) ??
      parseDateMs(row.created_at);
    if (
      options.userId &&
      rowClaimedByUserId &&
      rowClaimedByUserId === options.userId &&
      claimedAt &&
      Date.now() - claimedAt > SELF_RETRY_PROCESSING_TTL_MS
    ) {
      return true;
    }

    if (claimedAt && Date.now() - claimedAt > STALE_PROCESSING_TTL_MS) {
      return true;
    }
  }

  return false;
};

const addIfPresent = (row: RowRecord, key: string, value: unknown, target: RowRecord) => {
  if (Object.prototype.hasOwnProperty.call(row, key)) {
    target[key] = value;
  }
};

const markRowAsRecoveredInMemory = (row: RowRecord) => {
  const statusField = inferStatusFieldName(row);
  if (statusField) {
    row[statusField] = "failed";
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_at")) {
    row.claimed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_by_user_id")) {
    row.claimed_by_user_id = null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "claimed_by")) {
    row.claimed_by = null;
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

const buildUpdatePayloadForRecovery = (row: RowRecord) => {
  const nowIso = new Date().toISOString();
  const payload: RowRecord = {};
  const statusField = inferStatusFieldName(row);
  if (statusField) {
    payload[statusField] = "failed";
  }

  addIfPresent(row, "updated_at", nowIso, payload);
  addIfPresent(row, "processed_at", nowIso, payload);
  addIfPresent(row, "claimed_at", null, payload);
  addIfPresent(row, "claimed_by_user_id", null, payload);
  addIfPresent(row, "claimed_by", null, payload);
  addIfPresent(row, "last_error", "Recovered from stuck processing lock", payload);
  addIfPresent(row, "error", "Recovered from stuck processing lock", payload);

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
  if (args.status !== "processing") {
    addIfPresent(row, "claimed_at", null, payload);
    addIfPresent(row, "claimed_by_user_id", null, payload);
    addIfPresent(row, "claimed_by", null, payload);
  }
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

const normalizeTagToken = (value: unknown) =>
  normalizeString(value)
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);

const parseTagList = (value: unknown): string[] => {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseTagList(entry));
  }

  if (typeof value === "object") {
    const bag = value as Record<string, unknown>;
    const nested = bag.tags ?? bag.values ?? bag.items ?? bag.list ?? null;
    if (nested != null) {
      return parseTagList(nested);
    }
    return Object.values(bag).flatMap((entry) => parseTagList(entry));
  }

  const text = normalizeString(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      return parseTagList(parsed);
    } catch {
      // Delimited fallback below.
    }
  }

  return text
    .split(/[,\n;|]+/)
    .map((item) => normalizeTagToken(item))
    .filter(Boolean);
};

const dedupeStrings = (values: string[]) => Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));

const parseUrlList = (value: unknown): string[] => {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return dedupeStrings(value.map((item) => normalizeString(item)).filter(Boolean));
  }

  const text = normalizeString(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      return parseUrlList(parsed);
    } catch {
      // Continue with delimiter split.
    }
  }

  return dedupeStrings(
    text
      .split(/[,\n;|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

const parseBase64List = (value: unknown): string[] => {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return dedupeStrings(value.map((item) => normalizeString(item)).filter(Boolean));
  }

  const text = normalizeString(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      return parseBase64List(parsed);
    } catch {
      // Keep raw string fallback below.
    }
  }

  return [text];
};

const mapListingPayload = (row: RowRecord): RowRecord => {
  const title = readFirstString(row, ["title", "name"]) ?? "";
  const description = readFirstString(row, ["description", "catalog_description"]) ?? "";
  const rawTags = readFirstValue(row, ["tags", "etiket", "tag_list", "tag_values"]);
  const tags = dedupeStrings(parseTagList(rawTags)).slice(0, 13);
  const category = readFirstString(row, ["category", "category_name"]) ?? "";
  const imageUrls = parseUrlList(readFirstValue(row, ["images", "image_urls", "photo_urls"]));
  const imageBase64List = parseBase64List(readFirstValue(row, ["image_base64", "image_base64_list"]));
  const variations = parseVariations(readFirstValue(row, ["variations", "variation", "variants"]));

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
    image_1_url: readFirstString(row, ["image_1_url", "image_url_1"]) ?? imageUrls[0] ?? null,
    image_2_url: readFirstString(row, ["image_2_url", "image_url_2"]) ?? imageUrls[1] ?? null,
    image_3_url: readFirstString(row, ["image_3_url", "image_url_3"]) ?? imageUrls[2] ?? null,
    image_1_base64: readFirstString(row, ["image_1_base64"]) ?? imageBase64List[0] ?? null,
    image_2_base64: readFirstString(row, ["image_2_base64"]) ?? imageBase64List[1] ?? null,
    image_3_base64: readFirstString(row, ["image_3_base64"]) ?? imageBase64List[2] ?? null,
    etsy_store_link: readFirstString(row, ["etsy_store_link"]),
    variations,
  };

  if (row.shipping_template && typeof row.shipping_template === "object") {
    payload.shipping_template = row.shipping_template;
  }

  return payload;
};

const loadAllListingRows = async () => {
  const pageSize = 1000;
  const maxRows = 12000;
  const rows: RowRecord[] = [];
  let from = 0;

  while (rows.length < maxRows) {
    const to = from + pageSize - 1;
    const query = await supabaseAdmin.from("listing").select("*").range(from, to);
    if (query.error) {
      throw new Error(query.error.message || "listing table query failed");
    }

    const page = ((query.data ?? []) as RowRecord[]) ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
};

type QueryError = {
  message?: string | null;
  code?: string | null;
};

type StoreAliasRow = {
  id?: string | null;
  shop_id?: string | null;
  store_id?: string | null;
};

const isMissingColumnError = (error: QueryError | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isMissingTableError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || message.includes("relation") || message.includes("does not exist");
};

const isRecoverableStoreError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  if (isMissingTableError(error)) {
    return true;
  }

  return (
    isMissingColumnError(error, "shop_id") ||
    isMissingColumnError(error, "store_id") ||
    isMissingColumnError(error, "id")
  );
};

const loadRowsForPreferredClientId = async (preferredClientId: string) => {
  const client = normalizeString(preferredClientId);
  if (!client) return [];

  const collected: RowRecord[] = [];
  const candidates = ["client_id", "store_id"] as const;
  for (const column of candidates) {
    let from = 0;
    const pageSize = 800;
    for (;;) {
      const to = from + pageSize - 1;
      const query = await supabaseAdmin.from("listing").select("*").eq(column, client).range(from, to);
      if (query.error) {
        if (isMissingColumnError(query.error, column) || isMissingTableError(query.error)) {
          break;
        }
        throw new Error(query.error.message || "listing preferred client query failed");
      }

      const page = ((query.data ?? []) as RowRecord[]) ?? [];
      if (page.length === 0) break;
      collected.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
      if (from > 10000) break;
    }
  }

  // de-dup by identifier
  const map = new Map<string, RowRecord>();
  for (const row of collected) {
    const id = readFirstString(row, ["id", "key"]);
    const key = id || `${readClientId(row) || ""}:${parseDateMs(row.created_at) || 0}:${Math.random().toString(36).slice(2, 8)}`;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
};

const getAliasesFromStoreRow = (row: StoreAliasRow) => {
  const aliases = [normalizeString(row.id), normalizeString(row.shop_id), normalizeString(row.store_id)].filter(Boolean);
  return Array.from(new Set(aliases));
};

const loadStoreAliasRowsByUser = async (userId: string): Promise<StoreAliasRow[]> => {
  const candidates = ["id,shop_id,store_id", "id,shop_id", "id,store_id", "id"] as const;
  let lastError: QueryError | null = null;

  for (const select of candidates) {
    const query = await supabaseAdmin.from("stores").select(select).eq("user_id", userId).limit(2000);
    if (!query.error) {
      return ((query.data ?? []) as StoreAliasRow[]) ?? [];
    }

    lastError = query.error;
    if (!isRecoverableStoreError(query.error)) {
      throw new Error(query.error.message || "stores table query failed");
    }
  }

  if (isMissingTableError(lastError)) {
    return [];
  }

  return [];
};

const loadStoreAliasesByUser = async (userId: string) => {
  const rows = await loadStoreAliasRowsByUser(userId);
  const aliases = new Set<string>();

  for (const row of rows) {
    for (const alias of getAliasesFromStoreRow(row)) {
      aliases.add(alias);
    }
  }

  return aliases;
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
  const allStoreAliases = await loadStoreAliasesByUser(args.userId);
  let preferredAliases: Set<string> | null = null;

  if (preferredClientId) {
    if (!allStoreAliases.has(preferredClientId)) {
      return null;
    }

    // Mağaza seçildiyse claim yalnızca seçili mağazanın exact client_id değeriyle yapılır.
    preferredAliases = new Set([preferredClientId]);
  }

  const allowedClientIds = preferredAliases
    ? new Set<string>([...allStoreAliases])
    : allStoreAliases;
  const targetedRows = preferredClientId ? await loadRowsForPreferredClientId(preferredClientId) : [];
  const rows = targetedRows.length > 0 ? targetedRows : await loadAllListingRows();

  const pickEligibleRows = (options: { strictOwnership: boolean }) =>
    rows
      .filter((row) => {
        if (preferredAliases) {
          const rowClientId = readClientId(row);
          if (!rowClientId || !preferredAliases.has(rowClientId)) {
            return false;
          }
        }

        if (!options.strictOwnership && preferredAliases) {
          return true;
        }

        return rowBelongsToUser(row, { userId: args.userId, allowedClientIds });
      })
      .filter((row) => isRowPending(row, { userId: args.userId }))
      .sort(sortByOldestFirst);

  let eligibleRows = pickEligibleRows({ strictOwnership: true });

  // Fallback: Seçili mağazaya göre client_id eşleşen kayıtlar, ownership alanları eksikse de yakala.
  if (eligibleRows.length === 0 && preferredAliases) {
    eligibleRows = pickEligibleRows({ strictOwnership: false });
  }

  const recoverStuckProcessingLocks = async () => {
    const candidateRows = rows.filter((row) => {
      const status = normalizeStatus(row.status ?? row.listing_status);
      if (status !== "processing") {
        return false;
      }

      if (preferredAliases) {
        const rowClientId = readClientId(row);
        if (!rowClientId || !preferredAliases.has(rowClientId)) {
          return false;
        }
      }

      const belongs = rowBelongsToUser(row, { userId: args.userId, allowedClientIds });
      if (!belongs) {
        return false;
      }

      const claimedBy = readFirstString(row, ["claimed_by_user_id", "claimed_by"]);
      const ageMs =
        Date.now() -
        (parseDateMs(row.claimed_at) ??
          parseDateMs(row.updated_at) ??
          parseDateMs(row.processed_at) ??
          parseDateMs(row.created_at) ??
          Date.now());

      if (claimedBy && claimedBy === args.userId) {
        return ageMs > SELF_RETRY_PROCESSING_TTL_MS;
      }

      if (!claimedBy) {
        return ageMs > ORPHAN_PROCESSING_RECOVER_MS;
      }

      return ageMs > STUCK_PROCESSING_FORCE_RECOVER_MS;
    });

    let recovered = 0;
    for (const row of candidateRows.slice(0, 25)) {
      const identifier = inferIdentifier(row);
      if (!identifier) continue;

      const payload = buildUpdatePayloadForRecovery(row);
      try {
        await updateRowByIdentifier(identifier, payload);
        markRowAsRecoveredInMemory(row);
        recovered += 1;
      } catch {
        // no-op: continue recovering other rows
      }
    }

    return recovered;
  };

  if (args.forceRecover) {
    await recoverStuckProcessingLocks();
    eligibleRows = pickEligibleRows({ strictOwnership: true });
    if (eligibleRows.length === 0 && preferredAliases) {
      eligibleRows = pickEligibleRows({ strictOwnership: false });
    }
  }

  if (eligibleRows.length === 0) {
    const recoveredCount = await recoverStuckProcessingLocks();
    if (recoveredCount > 0) {
      eligibleRows = pickEligibleRows({ strictOwnership: true });
      if (eligibleRows.length === 0 && preferredAliases) {
        eligibleRows = pickEligibleRows({ strictOwnership: false });
      }
    }
  }

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
  clientId?: string | null;
  listingPayload?: RowRecord | null;
  status: "processing" | "completed" | "failed";
  error?: string | null;
  etsyListingId?: string | null;
  etsyListingUrl?: string | null;
  publishProof?: string | null;
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

const resolveIdentifierCandidatesFromArgs = (args: ReportArgs): ListingIdentifier[] => {
  const candidates: ListingIdentifier[] = [];
  const seen = new Set<string>();

  const push = (candidate: ListingIdentifier | null) => {
    if (!candidate) return;
    const key = `${candidate.column}:${candidate.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const listingId = normalizeString(args.listingId);
  const listingKey = normalizeString(args.listingKey);

  if (listingId) {
    push({ column: "id", value: listingId });
  }
  if (listingKey) {
    push({ column: "key", value: listingKey });
  }

  // Some clients may accidentally post listing_key inside listing_id.
  if (listingId && !listingKey) {
    push({ column: "key", value: listingId });
  }

  return candidates;
};

const loadListingByEtsyListingId = async (etsyListingId: string) => {
  const safeId = normalizeString(etsyListingId);
  if (!safeId) {
    return null;
  }

  const query = await supabaseAdmin.from("listing").select("*").eq("etsy_listing_id", safeId).maybeSingle<RowRecord>();
  if (query.error) {
    if (isMissingColumnError(query.error, "etsy_listing_id") || isMissingTableError(query.error)) {
      return null;
    }
    throw new Error(query.error.message || "listing etsy_listing_id lookup failed");
  }
  return query.data ?? null;
};

const toRecord = (value: unknown): RowRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RowRecord;
};

const buildFallbackListingInsertPayloadFromReport = (args: ReportArgs) => {
  const nowIso = new Date().toISOString();
  const source = toRecord(args.listingPayload) ?? {};
  const generatedFallbackId =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `lf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const listingIdFromPayload = normalizeString(source.listing_id ?? source.id);
  const listingKeyFromPayload = normalizeString(source.listing_key ?? source.key);
  const listingKeyFromArgs = normalizeString(args.listingKey);
  const listingIdFromArgs = normalizeString(args.listingId);

  const clientId =
    normalizeString(args.clientId) ||
    normalizeString(source.client_id ?? source.clientId ?? source.store_id ?? source.storeId) ||
    null;

  const tags = dedupeStrings(
    parseTagList(readFirstValue(source, ["tags", "tag_list", "tag_values", "keywords"]))
  ).slice(0, 13);

  const payload: RowRecord = {
    id: listingIdFromPayload || generatedFallbackId,
    key: listingKeyFromPayload || listingKeyFromArgs || undefined,
    client_id: clientId || undefined,
    store_id: clientId || undefined,
    user_id: args.userId || undefined,
    owner_user_id: args.userId || undefined,
    title: readFirstString(source, ["title", "name", "listing_title"]) || undefined,
    description: readFirstString(source, ["description", "catalog_description", "listing_description"]) || undefined,
    category: readFirstString(source, ["category", "category_name"]) || undefined,
    tags,
    price: toFiniteNumberOr(readFirstValue(source, ["price", "sale_price", "amount_usd"]), 0),
    quantity: toFiniteNumberOr(readFirstValue(source, ["quantity", "qty", "stock"]), 1),
    image_1_url: readFirstString(source, ["image_1_url", "image_url_1"]) || undefined,
    image_2_url: readFirstString(source, ["image_2_url", "image_url_2"]) || undefined,
    image_3_url: readFirstString(source, ["image_3_url", "image_url_3"]) || undefined,
    image_1_base64: readFirstString(source, ["image_1_base64"]) || undefined,
    image_2_base64: readFirstString(source, ["image_2_base64"]) || undefined,
    image_3_base64: readFirstString(source, ["image_3_base64"]) || undefined,
    variations: Array.isArray(source.variations) ? source.variations : undefined,
    status: args.status,
    listing_status: args.status,
    updated_at: nowIso,
    created_at: nowIso,
    processed_at: nowIso,
    completed_at: args.status === "completed" ? nowIso : undefined,
    claimed_at: null,
    claimed_by_user_id: null,
    claimed_by: null,
    last_error: args.error ?? null,
    error: args.error ?? null,
    etsy_listing_id: normalizeString(args.etsyListingId) || undefined,
    etsy_listing_url: normalizeString(args.etsyListingUrl) || undefined,
    etsy_store_link: normalizeString(args.etsyListingUrl) || undefined,
  };

  // If listing_id from args looks like Etsy id and there is no explicit payload id, keep it only as Etsy proof.
  if (!listingIdFromPayload && listingIdFromArgs && /^\d{5,}$/.test(listingIdFromArgs)) {
    if (!payload.etsy_listing_id) {
      payload.etsy_listing_id = listingIdFromArgs;
    }
  } else if (!listingIdFromPayload && listingIdFromArgs) {
    payload.id = listingIdFromArgs;
  }

  if (
    source.shipping_template &&
    typeof source.shipping_template === "object" &&
    !Array.isArray(source.shipping_template)
  ) {
    payload.shipping_template = source.shipping_template;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
  ) as RowRecord;
};

const upsertMissingListingFromReport = async (args: ReportArgs) => {
  let insertPayload = buildFallbackListingInsertPayloadFromReport(args);
  if (Object.keys(insertPayload).length === 0) {
    return null;
  }

  const candidates = resolveIdentifierCandidatesFromArgs(args);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabaseAdmin.from("listing").insert(insertPayload).select("*").maybeSingle<RowRecord>();
    if (!result.error) {
      const insertedRow = result.data ?? null;
      if (!insertedRow) {
        break;
      }
      const identifier = inferIdentifier(insertedRow);
      return identifier ? { row: insertedRow, identifier } : null;
    }

    const errorMessage = result.error.message || "listing insert failed";
    const missingColumn = extractMissingColumnName(errorMessage);
    if (missingColumn && Object.prototype.hasOwnProperty.call(insertPayload, missingColumn)) {
      const { [missingColumn]: _removed, ...rest } = insertPayload;
      insertPayload = rest;
      continue;
    }

    if (
      /invalid input syntax for type uuid/i.test(errorMessage) &&
      Object.prototype.hasOwnProperty.call(insertPayload, "id")
    ) {
      const { id: _removeId, ...rest } = insertPayload;
      insertPayload = rest;
      continue;
    }

    if (result.error.code === "23505") {
      for (const candidate of candidates) {
        const concurrentRow = await loadListingByIdentifier(candidate);
        if (concurrentRow) {
          return { row: concurrentRow, identifier: candidate };
        }
      }
    }

    throw new Error(errorMessage);
  }

  return null;
};

const hasCompletionProof = (args: ReportArgs) => {
  const publishProof = normalizeString(args.publishProof);
  if (publishProof) {
    return true;
  }

  const etsyListingId = normalizeString(args.etsyListingId);
  if (etsyListingId) {
    return true;
  }

  const etsyListingUrl = normalizeString(args.etsyListingUrl);
  if (!etsyListingUrl) {
    return false;
  }

  return !/\/listing-editor\//i.test(etsyListingUrl);
};

export const applyListingJobReport = async (args: ReportArgs) => {
  const identifierCandidates = resolveIdentifierCandidatesFromArgs(args);
  if (identifierCandidates.length === 0) {
    return { ok: false, reason: "identifier_missing" as const };
  }

  let resolvedIdentifier: ListingIdentifier | null = null;
  let row: RowRecord | null = null;

  for (const candidate of identifierCandidates) {
    const found = await loadListingByIdentifier(candidate);
    if (found) {
      resolvedIdentifier = candidate;
      row = found;
      break;
    }
  }

  if (!row) {
    const etsyListingId = normalizeString(args.etsyListingId || args.listingId);
    if (etsyListingId) {
      const byEtsyId = await loadListingByEtsyListingId(etsyListingId);
      if (byEtsyId) {
        row = byEtsyId;
        resolvedIdentifier = inferIdentifier(byEtsyId);
      }
    }
  }

  let fallbackInserted = false;
  if (!row || !resolvedIdentifier) {
    const inserted = await upsertMissingListingFromReport(args);
    if (inserted) {
      row = inserted.row;
      resolvedIdentifier = inserted.identifier;
      fallbackInserted = true;
    }
  }

  if (!row || !resolvedIdentifier) {
    return { ok: false, reason: "listing_not_found" as const };
  }

  const allowedClientIds = await loadStoreAliasesByUser(args.userId);
  const belongs = fallbackInserted
    ? true
    : rowBelongsToUser(row, {
        userId: args.userId,
        allowedClientIds,
      });

  if (!belongs) {
    return { ok: false, reason: "not_owner" as const };
  }

  let reportStatus: ReportArgs["status"] = args.status;
  let reportError = args.error ?? null;

  if (reportStatus === "completed" && !hasCompletionProof(args)) {
    reportStatus = "failed";
    reportError = reportError || "Publish doğrulaması bulunamadı";
  }

  const payload = buildUpdatePayloadForReport(row, {
    status: reportStatus,
    error: reportError,
    etsyListingId: normalizeString(args.etsyListingId) || null,
    etsyListingUrl: normalizeString(args.etsyListingUrl) || null,
  });

  await updateRowByIdentifier(resolvedIdentifier, payload);
  return { ok: true as const };
};

type GuestSyncArgs = {
  clientId: string;
  listingPayload: RowRecord;
  source?: string | null;
};

type GuestReportArgs = {
  clientId: string;
  listingId?: string | null;
  listingKey?: string | null;
  status: "processing" | "completed" | "failed";
  error?: string | null;
  etsyListingId?: string | null;
  etsyListingUrl?: string | null;
  publishProof?: string | null;
};

const extractMissingColumnName = (message: string) => {
  const normalized = String(message || "");
  const match =
    normalized.match(/column\s+"([^"]+)"\s+of\s+relation\s+"listing"\s+does\s+not\s+exist/i) ??
    normalized.match(/column\s+([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  return match?.[1] ? String(match[1]).trim() : null;
};

const toFiniteNumberOr = (value: unknown, fallback: number) => {
  const maybe = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(maybe) ? maybe : fallback;
};

const buildGuestListingInsertPayload = (listingPayload: RowRecord, clientId: string) => {
  const nowIso = new Date().toISOString();
  const normalizedClientId = normalizeString(clientId);
  const listingId = normalizeString(listingPayload.listing_id ?? listingPayload.id);
  const listingKey = normalizeString(listingPayload.listing_key ?? listingPayload.key);

  const tags = dedupeStrings(
    parseTagList(readFirstValue(listingPayload, ["tags", "tag_list", "tag_values"]))
  ).slice(0, 13);

  const payload: RowRecord = {
    id: listingId || undefined,
    key: listingKey || undefined,
    client_id: normalizedClientId || undefined,
    store_id: normalizedClientId || undefined,
    title: normalizeString(listingPayload.title),
    description: normalizeString(listingPayload.description),
    category: normalizeString(listingPayload.category ?? listingPayload.category_name),
    tags,
    price: toFiniteNumberOr(listingPayload.price, 0),
    quantity: toFiniteNumberOr(listingPayload.quantity, 1),
    image_1_url: normalizeString(listingPayload.image_1_url),
    image_2_url: normalizeString(listingPayload.image_2_url),
    image_3_url: normalizeString(listingPayload.image_3_url),
    image_1_base64: normalizeString(listingPayload.image_1_base64),
    image_2_base64: normalizeString(listingPayload.image_2_base64),
    image_3_base64: normalizeString(listingPayload.image_3_base64),
    variations: Array.isArray(listingPayload.variations) ? listingPayload.variations : undefined,
    status: "processing",
    listing_status: "processing",
    updated_at: nowIso,
    created_at: nowIso,
    claimed_at: nowIso,
    claimed_by_user_id: null,
    claimed_by: null,
    last_error: null,
    error: null,
  };

  if (
    listingPayload.shipping_template &&
    typeof listingPayload.shipping_template === "object" &&
    !Array.isArray(listingPayload.shipping_template)
  ) {
    payload.shipping_template = listingPayload.shipping_template;
  }

  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
  );

  return cleaned;
};

const buildGuestListingUpdatePayload = (row: RowRecord, listingPayload: RowRecord, clientId: string) => {
  const nowIso = new Date().toISOString();
  const payload: RowRecord = {};
  const statusField = inferStatusFieldName(row);

  const setIfColumnExists = (column: string, value: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(row, column)) return;
    payload[column] = value;
  };

  if (statusField) {
    payload[statusField] = "processing";
  }

  setIfColumnExists("updated_at", nowIso);
  setIfColumnExists("claimed_at", nowIso);
  setIfColumnExists("claimed_by_user_id", null);
  setIfColumnExists("claimed_by", null);
  setIfColumnExists("last_error", null);
  setIfColumnExists("error", null);

  const normalizedClientId = normalizeString(clientId);
  if (normalizedClientId) {
    setIfColumnExists("client_id", normalizedClientId);
    setIfColumnExists("store_id", normalizedClientId);
  }

  const fieldMap: Array<[string, unknown]> = [
    ["title", normalizeString(listingPayload.title)],
    ["description", normalizeString(listingPayload.description)],
    ["category", normalizeString(listingPayload.category ?? listingPayload.category_name)],
    [
      "tags",
      dedupeStrings(parseTagList(readFirstValue(listingPayload, ["tags", "tag_list", "tag_values"]))).slice(0, 13),
    ],
    ["price", toFiniteNumberOr(listingPayload.price, readFirstNumber(row, ["price"]) ?? 0)],
    ["quantity", toFiniteNumberOr(listingPayload.quantity, readFirstNumber(row, ["quantity"]) ?? 1)],
    ["image_1_url", normalizeString(listingPayload.image_1_url)],
    ["image_2_url", normalizeString(listingPayload.image_2_url)],
    ["image_3_url", normalizeString(listingPayload.image_3_url)],
    ["image_1_base64", normalizeString(listingPayload.image_1_base64)],
    ["image_2_base64", normalizeString(listingPayload.image_2_base64)],
    ["image_3_base64", normalizeString(listingPayload.image_3_base64)],
    ["variations", Array.isArray(listingPayload.variations) ? listingPayload.variations : undefined],
  ];

  for (const [column, value] of fieldMap) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    payload[column] = value;
  }

  if (
    Object.prototype.hasOwnProperty.call(row, "shipping_template") &&
    listingPayload.shipping_template &&
    typeof listingPayload.shipping_template === "object" &&
    !Array.isArray(listingPayload.shipping_template)
  ) {
    payload.shipping_template = listingPayload.shipping_template;
  }

  return payload;
};

export const syncGuestListingPayload = async (args: GuestSyncArgs) => {
  const clientId = normalizeString(args.clientId);
  if (!clientId) {
    return { ok: false as const, reason: "client_id_missing" as const };
  }

  const rawPayload =
    args.listingPayload && typeof args.listingPayload === "object" && !Array.isArray(args.listingPayload)
      ? args.listingPayload
      : ({} as RowRecord);

  const listingId = normalizeString(rawPayload.listing_id ?? rawPayload.id);
  const listingKey = normalizeString(rawPayload.listing_key ?? rawPayload.key);
  const identifier = listingId
    ? ({ column: "id", value: listingId } as const)
    : listingKey
      ? ({ column: "key", value: listingKey } as const)
      : null;

  if (!identifier) {
    return { ok: false as const, reason: "identifier_missing" as const };
  }

  const existing = await loadListingByIdentifier(identifier);
  if (existing) {
    const rowClientId = readClientId(existing);
    if (rowClientId && rowClientId !== clientId) {
      return { ok: false as const, reason: "client_mismatch" as const };
    }

    const updatePayload = buildGuestListingUpdatePayload(existing, rawPayload, clientId);
    await updateRowByIdentifier(identifier, updatePayload);
    return { ok: true as const, mode: "updated" as const, identifier };
  }

  let insertPayload = buildGuestListingInsertPayload(rawPayload, clientId);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabaseAdmin.from("listing").insert(insertPayload).select("*").maybeSingle<RowRecord>();
    if (!result.error) {
      return { ok: true as const, mode: "inserted" as const, identifier };
    }

    const errorMessage = result.error.message || "listing insert failed";
    const missingColumn = extractMissingColumnName(errorMessage);
    if (missingColumn && Object.prototype.hasOwnProperty.call(insertPayload, missingColumn)) {
      const { [missingColumn]: _removed, ...rest } = insertPayload;
      insertPayload = rest;
      continue;
    }

    if (result.error.code === "23505") {
      const concurrentRow = await loadListingByIdentifier(identifier);
      if (concurrentRow) {
        const updatePayload = buildGuestListingUpdatePayload(concurrentRow, rawPayload, clientId);
        await updateRowByIdentifier(identifier, updatePayload);
        return { ok: true as const, mode: "updated" as const, identifier };
      }
    }

    throw new Error(errorMessage);
  }

  return { ok: false as const, reason: "insert_payload_exhausted" as const };
};

export const resetFailedListingForUser = async (args: {
  userId: string;
  listingId: string;
}): Promise<boolean> => {
  const listingId = normalizeString(args.listingId);
  if (!listingId || !args.userId) return false;

  const identifier: ListingIdentifier = { column: "id", value: listingId };
  const listing = await loadListingByIdentifier(identifier);
  if (!listing) return false;

  const allStoreAliases = await loadStoreAliasesByUser(args.userId);
  const belongs = rowBelongsToUser(listing, { userId: args.userId, allowedClientIds: allStoreAliases });
  if (!belongs) return false;

  const status = normalizeStatus(listing.status ?? listing.listing_status);
  // "failed" ya da "processing" kabul et: reportJobToApi network hatası alırsa listing
  // "processing" kalabilir; extension job hatası aldığına göre reset güvenlidir.
  if (status !== "failed" && status !== "processing") return false;

  const nowIso = new Date().toISOString();
  const payload: RowRecord = {};
  const statusField = inferStatusFieldName(listing);
  if (statusField) payload[statusField] = "pending";
  addIfPresent(listing, "updated_at", nowIso, payload);
  addIfPresent(listing, "claimed_at", null, payload);
  addIfPresent(listing, "claimed_by_user_id", null, payload);
  addIfPresent(listing, "claimed_by", null, payload);
  addIfPresent(listing, "error", null, payload);
  addIfPresent(listing, "last_error", null, payload);

  await updateRowByIdentifier(identifier, payload);
  return true;
};

export const applyGuestListingJobReport = async (args: GuestReportArgs) => {
  const clientId = normalizeString(args.clientId);
  if (!clientId) {
    return { ok: false as const, reason: "client_id_missing" as const };
  }

  const identifier = resolveIdentifierFromArgs({
    userId: "",
    listingId: args.listingId ?? null,
    listingKey: args.listingKey ?? null,
    status: args.status,
    error: args.error ?? null,
    etsyListingId: args.etsyListingId ?? null,
    etsyListingUrl: args.etsyListingUrl ?? null,
    publishProof: args.publishProof ?? null,
  });

  if (!identifier) {
    return { ok: false as const, reason: "identifier_missing" as const };
  }

  const row = await loadListingByIdentifier(identifier);
  if (!row) {
    return { ok: false as const, reason: "listing_not_found" as const };
  }

  const rowClientId = readClientId(row);
  if (rowClientId && rowClientId !== clientId) {
    return { ok: false as const, reason: "client_mismatch" as const };
  }

  let reportStatus: GuestReportArgs["status"] = args.status;
  let reportError = args.error ?? null;
  if (
    reportStatus === "completed" &&
    !hasCompletionProof({
      userId: "",
      listingId: args.listingId ?? null,
      listingKey: args.listingKey ?? null,
      status: args.status,
      error: args.error ?? null,
      etsyListingId: args.etsyListingId ?? null,
      etsyListingUrl: args.etsyListingUrl ?? null,
      publishProof: args.publishProof ?? null,
    })
  ) {
    reportStatus = "failed";
    reportError = reportError || "Publish doğrulaması bulunamadı";
  }

  const payload = buildUpdatePayloadForReport(row, {
    status: reportStatus,
    error: reportError,
    etsyListingId: normalizeString(args.etsyListingId) || null,
    etsyListingUrl: normalizeString(args.etsyListingUrl) || null,
  });

  await updateRowByIdentifier(identifier, payload);
  return { ok: true as const };
};
