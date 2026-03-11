import { getEtsyConnection, upsertEtsyConnection } from "@/lib/etsy/connection";
import {
  buildEtsyCallbackUrl,
  hasEtsyBaseCredentials,
  readEtsyRuntimeConfig,
  type EtsyRuntimeConfig,
} from "@/lib/etsy/config";

const TOKEN_PATH = "/public/oauth/token";
const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type TokenCache = {
  token: string;
  expiresAt: number;
};

export type EtsyTokenGrantResponse = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresInSeconds: number;
  etsyUserId: string;
};

export class EtsyApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EtsyApiError";
    this.status = status;
  }
}

const tokenCache = new Map<string, TokenCache>();
const tokenInFlight = new Map<string, Promise<string>>();

const withTimeout = async <T>(promiseFactory: (signal: AbortSignal) => Promise<T>, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Etsy request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseApiError = async (response: Response) => {
  const text = await response.text();
  let message = `Etsy request failed with HTTP ${response.status}`;

  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        message = parsed.error.trim();
      } else if (typeof parsed.error_description === "string" && parsed.error_description.trim()) {
        message = parsed.error_description.trim();
      } else if (typeof parsed.message === "string" && parsed.message.trim()) {
        message = parsed.message.trim();
      }
    } catch {
      message = text;
    }
  }

  return new EtsyApiError(message, response.status);
};

const extractEtsyUserIdFromToken = (token: string) => {
  const trimmed = token.trim();
  const [prefix] = trimmed.split(".", 1);
  if (!prefix || !/^\d+$/.test(prefix)) {
    throw new Error("Etsy token did not include numeric user prefix.");
  }
  return prefix;
};

const parseTokenResponse = async (response: Response): Promise<EtsyTokenGrantResponse> => {
  if (!response.ok) {
    throw await parseApiError(response);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: string | number;
  };

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
  const tokenType = typeof payload.token_type === "string" ? payload.token_type.trim() : null;
  const expiresInRaw = payload.expires_in;
  const expiresInSeconds =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : typeof expiresInRaw === "string"
        ? Number(expiresInRaw)
        : 0;

  if (!accessToken) {
    throw new Error("Etsy access token response does not include access_token.");
  }

  return {
    accessToken,
    refreshToken: refreshToken || null,
    tokenType,
    expiresInSeconds: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600,
    etsyUserId: extractEtsyUserIdFromToken(accessToken),
  };
};

const computeExpiryMs = (expiresInSeconds: number) => {
  return Date.now() + Math.max(expiresInSeconds - TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS, 10) * 1000;
};

const ensureEtsyBaseCredentials = (config: EtsyRuntimeConfig) => {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Etsy credentials are missing. Set ETSY_CLIENT_ID and ETSY_CLIENT_SECRET.");
  }
};

const requestTokenGrant = async (args: {
  config: EtsyRuntimeConfig;
  form: URLSearchParams;
}) => {
  return withTimeout(async (signal) => {
    const response = await fetch(`${args.config.apiBaseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: args.form.toString(),
      signal,
    });

    return parseTokenResponse(response);
  }, args.config.timeoutMs);
};

export const exchangeEtsyAuthorizationCode = async (args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) => {
  const config = readEtsyRuntimeConfig();
  ensureEtsyBaseCredentials(config);

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", config.clientId);
  form.set("redirect_uri", args.redirectUri.trim());
  form.set("code", args.code.trim());
  form.set("code_verifier", args.codeVerifier.trim());

  return requestTokenGrant({ config, form });
};

export const refreshEtsyAccessToken = async (args: {
  refreshToken: string;
}) => {
  const config = readEtsyRuntimeConfig();
  ensureEtsyBaseCredentials(config);

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", config.clientId);
  form.set("refresh_token", args.refreshToken.trim());

  return requestTokenGrant({ config, form });
};

export const clearEtsyAccessTokenCache = () => {
  tokenCache.clear();
  tokenInFlight.clear();
};

const primeEtsyAccessTokenCache = (args: {
  accessToken: string;
  expiresInSeconds?: number;
  expiresAt?: string | null;
}) => {
  const expiresAt = args.expiresAt
    ? new Date(args.expiresAt).getTime()
    : computeExpiryMs(args.expiresInSeconds ?? 3600);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    tokenCache.delete("prod");
    return;
  }

  tokenCache.set("prod", {
    token: args.accessToken,
    expiresAt,
  });
};

const getCachedToken = () => {
  const cached = tokenCache.get("prod");
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenCache.delete("prod");
    return null;
  }

  return cached.token;
};

const refreshSharedAccessToken = async (force = false) => {
  if (!force) {
    const cached = getCachedToken();
    if (cached) {
      return cached;
    }
  }

  const inFlight = tokenInFlight.get("prod");
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const config = readEtsyRuntimeConfig();
    ensureEtsyBaseCredentials(config);

    const connection = await getEtsyConnection();
    if (!connection) {
      throw new Error("Etsy shared account is not connected yet. Complete admin authorization first.");
    }

    if (!force && connection.access_token) {
      primeEtsyAccessTokenCache({
        accessToken: connection.access_token,
        expiresAt: connection.access_token_expires_at,
      });
      const cached = getCachedToken();
      if (cached) {
        return cached;
      }
    }

    const refreshed = await refreshEtsyAccessToken({
      refreshToken: connection.refresh_token,
    });

    await upsertEtsyConnection({
      clientId: config.clientId,
      etsyUserId: refreshed.etsyUserId,
      refreshToken: refreshed.refreshToken ?? connection.refresh_token,
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString(),
      tokenType: refreshed.tokenType,
      connectedAt: connection.connected_at,
      createdBy: connection.created_by,
      updatedBy: connection.updated_by,
    });

    primeEtsyAccessTokenCache({
      accessToken: refreshed.accessToken,
      expiresInSeconds: refreshed.expiresInSeconds,
    });

    return refreshed.accessToken;
  })().finally(() => {
    tokenInFlight.delete("prod");
  });

  tokenInFlight.set("prod", request);
  return request;
};

const buildApiKeyHeader = (config: EtsyRuntimeConfig) => {
  ensureEtsyBaseCredentials(config);
  return `${config.clientId}:${config.clientSecret}`;
};

export const requestEtsyJson = async <T>(args: {
  path: string;
  method?: HttpMethod;
  body?: BodyInit | null;
  headers?: HeadersInit;
}) => {
  const config = readEtsyRuntimeConfig();
  ensureEtsyBaseCredentials(config);

  const requestOnce = async (accessToken: string) => {
    return withTimeout(async (signal) => {
      const response = await fetch(`${config.apiBaseUrl}${args.path}`, {
        method: args.method ?? "GET",
        headers: {
          "x-api-key": buildApiKeyHeader(config),
          Authorization: `Bearer ${accessToken}`,
          ...(args.headers ?? {}),
        },
        body: args.body ?? null,
        signal,
      });

      if (!response.ok) {
        throw await parseApiError(response);
      }

      return (await response.json()) as T;
    }, config.timeoutMs);
  };

  let accessToken = await refreshSharedAccessToken(false);
  try {
    return await requestOnce(accessToken);
  } catch (error) {
    if (error instanceof EtsyApiError && error.status === 401) {
      clearEtsyAccessTokenCache();
      accessToken = await refreshSharedAccessToken(true);
      return requestOnce(accessToken);
    }

    throw error;
  }
};

export const isEtsyConfigured = () => hasEtsyBaseCredentials();

export const getEtsySharedConnectionCallbackUrl = (origin: string) => buildEtsyCallbackUrl(origin);
