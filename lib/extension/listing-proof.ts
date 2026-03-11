type RowLike = Record<string, unknown>;

export const normalizeProofString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const isValidEtsyListingId = (value: unknown) => /^\d{5,}$/.test(normalizeProofString(value));

export const isEditorListingUrl = (value: unknown) => {
  const text = normalizeProofString(value);
  if (!text) return false;
  return /\/listing-editor\//i.test(text) || /\/your\/shops\/me\/listing-editor\//i.test(text);
};

export const isValidPublishedListingUrl = (value: unknown) => {
  const text = normalizeProofString(value);
  if (!text || isEditorListingUrl(text)) {
    return false;
  }

  try {
    const parsed = new URL(text);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith("etsy.com")) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.includes("/listing/") ||
      pathname.includes("/your/shops/me/listings/") ||
      pathname.includes("/your/shops/me/listing/")
    );
  } catch {
    return false;
  }
};

export const getRowString = (row: RowLike, keys: string[]) => {
  for (const key of keys) {
    const text = normalizeProofString(row[key]);
    if (text) {
      return text;
    }
  }
  return "";
};

export const resolveListingProofState = (row: RowLike) => {
  const listingId = getRowString(row, ["etsy_listing_id"]);
  const listingUrl = getRowString(row, ["etsy_listing_url", "etsy_store_link", "publish_proof"]);
  const validListingId = isValidEtsyListingId(listingId);
  const validListingUrl = isValidPublishedListingUrl(listingUrl);

  return {
    listingId: validListingId ? listingId : "",
    listingUrl: validListingUrl ? listingUrl : "",
    hasValidProof: validListingId || validListingUrl,
    proofKind: validListingUrl ? "url" : validListingId ? "id" : null,
    invalidEditorUrl: Boolean(listingUrl) && isEditorListingUrl(listingUrl),
  };
};

const COMPLETED_STATUSES = new Set(["done", "published", "uploaded", "success", "complete", "completed"]);

export const deriveListingRuntimeStatus = (row: RowLike, rawStatus: unknown) => {
  const statusText = normalizeProofString(rawStatus) || "pending";
  const normalized = statusText.toLowerCase();
  const proof = resolveListingProofState(row);

  if (proof.hasValidProof) {
    return {
      status: "completed",
      manualReview: false,
      manualReviewReason: null,
      proof,
    };
  }

  if (COMPLETED_STATUSES.has(normalized)) {
    return {
      status: "manual_review",
      manualReview: true,
      manualReviewReason: proof.invalidEditorUrl ? "editor_url_only" : "missing_publish_proof",
      proof,
    };
  }

  return {
    status: statusText,
    manualReview: false,
    manualReviewReason: null,
    proof,
  };
};
