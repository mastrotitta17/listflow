const ETSY_HOST_PATTERN = /(^|\.)etsy\.com$/i;

const cleanupExtractedName = (value: string) => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }

  decoded = decoded.trim();
  const withoutDelimiters = decoded.replace(/^[./\s]+|[./\s]+$/g, "");
  if (!withoutDelimiters) {
    return "";
  }

  return withoutDelimiters;
};

const parseEtsyStoreNameFromUrlLike = (raw: string) => {
  if (!raw) {
    return null;
  }

  const normalizedInput = raw.trim();
  if (!normalizedInput) {
    return null;
  }

  const likelyUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedInput)
    ? normalizedInput
    : normalizedInput.startsWith("etsy.com/") || normalizedInput.startsWith("www.etsy.com/")
      ? `https://${normalizedInput}`
      : normalizedInput.includes("etsy.com")
        ? `https://${normalizedInput.replace(/^\/+/, "")}`
        : normalizedInput;

  try {
    const parsed = new URL(likelyUrl);
    if (!ETSY_HOST_PATTERN.test(parsed.hostname)) {
      return null;
    }

    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const shopIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === "shop");
    if (shopIndex === -1) {
      return null;
    }

    const candidate = cleanupExtractedName(pathSegments[shopIndex + 1] ?? "");
    return candidate || null;
  } catch {
    return null;
  }
};

export const extractEtsyStoreName = (raw: string | null | undefined) => {
  const normalized = (raw ?? "").trim();
  if (!normalized) {
    return null;
  }

  const directPathMatch = normalized.match(/(?:^|\/)shop\/([^/?#]+)/i);
  if (directPathMatch?.[1]) {
    const candidate = cleanupExtractedName(directPathMatch[1]);
    if (candidate) {
      return candidate;
    }
  }

  return parseEtsyStoreNameFromUrlLike(normalized);
};

export const normalizeStoreNameInput = (raw: string | null | undefined) => {
  const normalized = (raw ?? "").trim();
  if (!normalized) {
    return "";
  }

  return extractEtsyStoreName(normalized) ?? normalized;
};
