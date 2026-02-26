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
  "failed",
  "error",
  "retry",
]);
const STALE_PROCESSING_TTL_MS = 60 * 1000;
const SELF_RETRY_PROCESSING_TTL_MS = 3 * 1000;
const STUCK_PROCESSING_FORCE_RECOVER_MS = 2 * 60 * 1000;
const ORPHAN_PROCESSING_RECOVER_MS = 30 * 1000;
const SUCCESS_STATUSES = new Set(["completed", "done", "success"]);

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
  const statusField = inferStatusFieldName(row);
  if (!statusField) {
    return true;
  }

  const status = normalizeStatus(row[statusField]);
  if (PENDING_STATUSES.has(status)) {
    return true;
  }

  // Bazı pipeline'larda status yanlışlıkla completed/done gelebiliyor.
  // Etsy publish referansı yoksa bu kaydı yeniden yüklenebilir kabul et.
  if (SUCCESS_STATUSES.has(status)) {
    const listingId = readFirstString(row, ["etsy_listing_id"]);
    const listingUrl = readFirstString(row, ["etsy_listing_url", "etsy_store_link"]);
    const hasUrlProof = Boolean(listingUrl && !/\/listing-editor\//i.test(listingUrl));
    const hasIdProof = Boolean(listingId);
    if (!hasUrlProof && !hasIdProof) {
      return true;
    }
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

const resolvePreferredStoreAliases = async (userId: string, preferredClientId: string) => {
  const rows = await loadStoreAliasRowsByUser(userId);

  for (const row of rows) {
    const aliases = getAliasesFromStoreRow(row);
    if (!aliases.includes(preferredClientId)) {
      continue;
    }

    return new Set<string>(aliases);
  }

  return null;
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
    preferredAliases = await resolvePreferredStoreAliases(args.userId, preferredClientId);
    // Store alias eşleşmesi bulunamazsa seçili client_id ile yine claim dene.
    if (!preferredAliases) {
      preferredAliases = new Set([preferredClientId]);
    }
  }

  const allowedClientIds = preferredAliases
    ? new Set<string>([...allStoreAliases, ...preferredAliases])
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

const hasCompletionProof = (args: ReportArgs) => {
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
  const identifier = resolveIdentifierFromArgs(args);
  if (!identifier) {
    return { ok: false, reason: "identifier_missing" as const };
  }

  const row = await loadListingByIdentifier(identifier);
  if (!row) {
    return { ok: false, reason: "listing_not_found" as const };
  }

  const allowedClientIds = await loadStoreAliasesByUser(args.userId);
  const belongs = rowBelongsToUser(row, {
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

  await updateRowByIdentifier(identifier, payload);
  return { ok: true as const };
};
