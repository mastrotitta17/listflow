const DEFAULT_R2_PUBLIC_ORIGIN = "https://pub-b9db5786e8af4a9b8f542561b9fc5298.r2.dev";
const DEFAULT_CDN_ORIGIN = "https://cdn.listflow.pro";
const DEFAULT_R2_PUBLIC_PATH_PREFIX = "/jobs/";
const DEFAULT_CDN_PUBLIC_PATH_PREFIX = "/job/";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const parseOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const R2_PUBLIC_ORIGIN = trimTrailingSlash(
  process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN || DEFAULT_R2_PUBLIC_ORIGIN
);

const CDN_PUBLIC_ORIGIN = trimTrailingSlash(
  process.env.NEXT_PUBLIC_CDN_PUBLIC_BASE_URL || DEFAULT_CDN_ORIGIN
);

const R2_PUBLIC_PATH_PREFIX = process.env.NEXT_PUBLIC_R2_PUBLIC_PATH_PREFIX || DEFAULT_R2_PUBLIC_PATH_PREFIX;
const CDN_PUBLIC_PATH_PREFIX = process.env.NEXT_PUBLIC_CDN_PUBLIC_PATH_PREFIX || DEFAULT_CDN_PUBLIC_PATH_PREFIX;

const R2_PUBLIC_HOST_ORIGIN = parseOrigin(R2_PUBLIC_ORIGIN);
const CDN_PUBLIC_HOST_ORIGIN = parseOrigin(CDN_PUBLIC_ORIGIN);

export const normalizePublicAssetUrl = (value: string | null | undefined) => {
  if (!value) {
    return value ?? null;
  }

  const trimmed = value.trim();
  if (!trimmed || !R2_PUBLIC_HOST_ORIGIN || !CDN_PUBLIC_HOST_ORIGIN) {
    return trimmed || null;
  }

  try {
    const url = new URL(trimmed);
    if (url.origin !== R2_PUBLIC_HOST_ORIGIN && url.origin !== CDN_PUBLIC_HOST_ORIGIN) {
      return trimmed;
    }

    const normalizedPath =
      url.pathname.startsWith(R2_PUBLIC_PATH_PREFIX)
        ? `${CDN_PUBLIC_PATH_PREFIX}${url.pathname.slice(R2_PUBLIC_PATH_PREFIX.length)}`
        : url.pathname;

    return `${CDN_PUBLIC_HOST_ORIGIN}${normalizedPath}${url.search}${url.hash}`;
  } catch {
    return trimmed;
  }
};

export const normalizePublicAssetUrls = (values: Array<string | null | undefined>) =>
  values
    .map((value) => normalizePublicAssetUrl(value))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
