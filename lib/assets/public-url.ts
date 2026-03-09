export const normalizePublicAssetUrl = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

export const normalizePublicAssetUrls = (values: Array<string | null | undefined>) =>
  values
    .map((value) => normalizePublicAssetUrl(value))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
