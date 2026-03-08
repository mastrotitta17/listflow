export type NavlungoEnvironment = "qa" | "prod";

export type NavlungoRuntimeConfig = {
  environment: NavlungoEnvironment;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  scopes: string[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCOPE = "openid offline_access";

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

const readEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

export const readNavlungoEnvironment = (): NavlungoEnvironment => {
  const raw = (readEnv("NAVLUNGO_ENV") ?? "qa").toLowerCase();
  return raw === "prod" ? "prod" : "qa";
};

export const getNavlungoAuthBaseUrl = (environment = readNavlungoEnvironment()) => {
  const override = readEnv("NAVLUNGO_AUTH_BASE_URL");
  if (override) {
    return override.replace(/\/+$/, "");
  }

  return environment === "prod" ? "https://navlungo.com" : "https://qa.navlungo.com";
};

export const getNavlungoApiBaseUrl = (environment = readNavlungoEnvironment()) => {
  const override = readEnv("NAVLUNGO_API_BASE_URL");
  if (override) {
    return override.replace(/\/+$/, "");
  }

  return environment === "prod" ? "https://api.navlungo.com" : "https://api-qa.navlungo.com";
};

export const getNavlungoScopes = () => {
  const raw = readEnv("NAVLUNGO_SCOPE") ?? DEFAULT_SCOPE;
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

export const readNavlungoRuntimeConfig = (environmentOverride?: NavlungoEnvironment): NavlungoRuntimeConfig => {
  const environment = environmentOverride ?? readNavlungoEnvironment();
  return {
    environment,
    authBaseUrl: getNavlungoAuthBaseUrl(environment),
    apiBaseUrl: getNavlungoApiBaseUrl(environment),
    clientId: readEnv("NAVLUNGO_CLIENT_ID") ?? "",
    clientSecret: readEnv("NAVLUNGO_CLIENT_SECRET") ?? "",
    timeoutMs: asPositiveInt(readEnv("NAVLUNGO_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS),
    scopes: getNavlungoScopes(),
  };
};

export const hasNavlungoBaseCredentials = () => {
  const config = readNavlungoRuntimeConfig();
  return Boolean(config.clientId && config.clientSecret);
};

export const buildNavlungoCallbackUrl = (origin: string) => {
  return new URL("/api/admin/navlungo/connect/callback", origin).toString();
};
