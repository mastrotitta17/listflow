export type EtsyRuntimeConfig = {
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  scopes: string[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCOPE = "shops_r listings_r listings_w";

const readEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const asPositiveInt = (raw: string | null | undefined, fallback: number) => {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
};

export const getEtsyAuthBaseUrl = () => {
  const override = readEnv("ETSY_AUTH_BASE_URL");
  return (override ?? "https://www.etsy.com").replace(/\/+$/, "");
};

export const getEtsyApiBaseUrl = () => {
  const override = readEnv("ETSY_API_BASE_URL");
  return (override ?? "https://api.etsy.com/v3").replace(/\/+$/, "");
};

export const getEtsyScopes = () => {
  const raw = readEnv("ETSY_OAUTH_SCOPE") ?? DEFAULT_SCOPE;
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

export const readEtsyRuntimeConfig = (): EtsyRuntimeConfig => {
  return {
    authBaseUrl: getEtsyAuthBaseUrl(),
    apiBaseUrl: getEtsyApiBaseUrl(),
    clientId: readEnv("ETSY_CLIENT_ID") ?? "",
    clientSecret: readEnv("ETSY_CLIENT_SECRET") ?? "",
    timeoutMs: asPositiveInt(readEnv("ETSY_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS),
    scopes: getEtsyScopes(),
  };
};

export const hasEtsyBaseCredentials = () => {
  const config = readEtsyRuntimeConfig();
  return Boolean(config.clientId && config.clientSecret);
};

export const buildEtsyCallbackUrl = (origin: string) => {
  return new URL("/api/admin/etsy/connect/callback", origin).toString();
};
