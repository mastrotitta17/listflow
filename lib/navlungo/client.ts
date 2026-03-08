import { getNavlungoConnection, upsertNavlungoConnection } from "@/lib/navlungo/connection";
import {
  hasNavlungoBaseCredentials,
  readNavlungoRuntimeConfig,
  type NavlungoEnvironment,
  type NavlungoRuntimeConfig,
} from "@/lib/navlungo/config";

const TOKEN_PATH = "/v1/oauth/token";
const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;

type HttpMethod = "GET" | "POST";

type TokenCache = {
  token: string;
  expiresAt: number;
};

export type NavlungoTokenGrantResponse = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string | null;
  expiresInSeconds: number;
};

export type NavlungoAdditionalService = {
  serviceCode: string;
  priceAmount?: number;
  currency?: string;
  isRequired?: boolean;
};

export type NavlungoQuote = {
  quoteReference: string;
  price?: number;
  currency?: string;
  serviceType?: string;
  minTransitTime?: number;
  maxTransitTime?: number;
  description?: string;
  carrier?: string;
  additionalServices?: NavlungoAdditionalService[];
};

export type NavlungoOrderQuoteRequest = {
  order: {
    orderReference: string;
    currencyCode: string;
    receiverAddress: {
      contactName: string;
      countryCode: string;
      state?: string;
      town: string;
      city: string;
      postalCode: string;
      firstLine: string;
    };
    receiverEmail?: string;
    receiverPhoneNumber: string;
    orderItems: Array<{
      quantity: number;
      price: string;
      description: string;
      sku: string;
      hsCode: string;
    }>;
  };
  packages: Array<{
    quantity: number;
    type: string;
    weight: number;
    width: number;
    length: number;
    height: number;
  }>;
  shipmentType: "sales" | "sample" | "micro-export" | "gift";
};

export type NavlungoOrderQuoteResponse = {
  searchId: string;
  quotes: NavlungoQuote[];
};

export type NavlungoShipStoreOrderRequest = {
  quoteReference: string;
  searchId: string;
  selectedAdditionalServices: string[];
};

export type NavlungoShipStoreOrderResponse = {
  shipmentId: string;
  shipmentReference: string;
  trackingUrl: string;
  cargoLabels?: string[];
  chargeableWeight?: number;
};

export type NavlungoShipmentLabelResponse = {
  labelUrl: string;
};

export type NavlungoCreateShipmentLabelResponse = {
  lastMileTrackingNumber?: string;
};

export type NavlungoStoreOrderTrackingResponse = Record<string, unknown> & {
  trackingNumber?: string;
  trackingUrl?: string;
  shipmentReference?: string;
  shipmentId?: string;
};

export type NavlungoShipmentTrackingResponse = Record<string, unknown> & {
  trackingNumber?: string;
};

export type NavlungoStoreAddress = {
  type: "Individual" | "Corporate";
  companyName?: string;
  identificationNumber: string;
  taxOffice?: string;
  contactName: string;
  contactPhone: string;
  contactMail: string;
  countryCode: string;
  state?: string;
  city: string;
  town: string;
  postalCode: string;
  firstLine: string;
  secondLine?: string;
  thirdLine?: string;
};

export type NavlungoCreateStoreRequest = {
  name: string;
  url?: string;
  storeId?: string;
  storeAddress: NavlungoStoreAddress;
  invoiceAddress: NavlungoStoreAddress;
};

export type NavlungoCreateStoreResponse = {
  storeId: string;
};

export type NavlungoApiErrorDetails = {
  type?: string;
  status?: number;
  problemCode?: string;
  title?: string;
  detail?: string;
  path?: string;
  extensions?: Record<string, unknown>;
};

export class NavlungoApiError extends Error {
  public readonly status: number;
  public readonly problemCode: string | null;
  public readonly details: NavlungoApiErrorDetails;

  constructor(message: string, args: { status: number; problemCode?: string | null; details?: NavlungoApiErrorDetails }) {
    super(message);
    this.name = "NavlungoApiError";
    this.status = args.status;
    this.problemCode = args.problemCode ?? null;
    this.details = args.details ?? {};
  }
}

const tokenCache = new Map<NavlungoEnvironment, TokenCache>();
const tokenInFlight = new Map<NavlungoEnvironment, Promise<string>>();

const parseApiError = async (response: Response): Promise<NavlungoApiError> => {
  const text = await response.text();
  let details: NavlungoApiErrorDetails = {};

  if (text) {
    try {
      details = JSON.parse(text) as NavlungoApiErrorDetails;
    } catch {
      details = {
        detail: text,
      };
    }
  }

  const message = details.detail || details.title || `Navlungo request failed with HTTP ${response.status}`;

  return new NavlungoApiError(message, {
    status: response.status,
    problemCode: details.problemCode ?? null,
    details,
  });
};

const withTimeout = async <T>(promiseFactory: (signal: AbortSignal) => Promise<T>, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Navlungo request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseTokenResponse = async (response: Response): Promise<NavlungoTokenGrantResponse> => {
  if (!response.ok) {
    throw await parseApiError(response);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: string | number;
  };

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
  const idToken = typeof payload.id_token === "string" ? payload.id_token.trim() : "";
  const tokenType = typeof payload.token_type === "string" ? payload.token_type.trim() : null;
  const expiresInRaw = payload.expires_in;
  const expiresInSeconds =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : typeof expiresInRaw === "string"
        ? Number(expiresInRaw)
        : 0;

  if (!accessToken) {
    throw new Error("Navlungo access token response does not include access_token");
  }

  return {
    accessToken,
    refreshToken: refreshToken || null,
    idToken: idToken || null,
    tokenType,
    expiresInSeconds: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 300,
  };
};

const computeExpiryMs = (expiresInSeconds: number) => {
  return Date.now() + Math.max(expiresInSeconds - TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS, 10) * 1000;
};

const ensureNavlungoBaseCredentials = (config: NavlungoRuntimeConfig) => {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Navlungo credentials are missing. Set NAVLUNGO_CLIENT_ID and NAVLUNGO_CLIENT_SECRET.");
  }
};

const requestTokenGrant = async (args: {
  config: NavlungoRuntimeConfig;
  form: URLSearchParams;
}): Promise<NavlungoTokenGrantResponse> => {
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

const buildScopeValue = (scopes: string[]) => scopes.join(" ").trim();

export const exchangeNavlungoAuthorizationCode = async (args: {
  code: string;
  codeVerifier: string;
  environment?: NavlungoEnvironment;
}): Promise<NavlungoTokenGrantResponse> => {
  const config = readNavlungoRuntimeConfig(args.environment);
  ensureNavlungoBaseCredentials(config);

  const form = new URLSearchParams();
  form.set("client_id", config.clientId);
  form.set("client_secret", config.clientSecret);
  form.set("grant_type", "authorization_code");
  form.set("code", args.code.trim());
  form.set("code_verifier", args.codeVerifier.trim());
  const scopeValue = buildScopeValue(config.scopes);
  if (scopeValue) {
    form.set("scope", scopeValue);
  }

  return requestTokenGrant({ config, form });
};

export const refreshNavlungoAccessToken = async (args: {
  refreshToken: string;
  environment?: NavlungoEnvironment;
}): Promise<NavlungoTokenGrantResponse> => {
  const config = readNavlungoRuntimeConfig(args.environment);
  ensureNavlungoBaseCredentials(config);

  const form = new URLSearchParams();
  form.set("client_id", config.clientId);
  form.set("client_secret", config.clientSecret);
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", args.refreshToken.trim());
  const scopeValue = buildScopeValue(config.scopes);
  if (scopeValue) {
    form.set("scope", scopeValue);
  }

  return requestTokenGrant({ config, form });
};

export const clearNavlungoAccessTokenCache = (environment?: NavlungoEnvironment) => {
  if (environment) {
    tokenCache.delete(environment);
    tokenInFlight.delete(environment);
    return;
  }

  tokenCache.clear();
  tokenInFlight.clear();
};

const primeNavlungoAccessTokenCache = (args: {
  environment: NavlungoEnvironment;
  accessToken: string;
  expiresInSeconds?: number;
  expiresAt?: string | null;
}) => {
  const expiresAt = args.expiresAt
    ? new Date(args.expiresAt).getTime()
    : computeExpiryMs(args.expiresInSeconds ?? 300);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    tokenCache.delete(args.environment);
    return;
  }

  tokenCache.set(args.environment, {
    token: args.accessToken,
    expiresAt,
  });
};

const getCachedToken = (environment: NavlungoEnvironment) => {
  const cached = tokenCache.get(environment);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenCache.delete(environment);
    return null;
  }

  return cached.token;
};

const refreshSharedAccessToken = async (environment: NavlungoEnvironment, force = false) => {
  if (!force) {
    const cached = getCachedToken(environment);
    if (cached) {
      return cached;
    }
  }

  const existingInFlight = tokenInFlight.get(environment);
  if (existingInFlight) {
    return existingInFlight;
  }

  const refreshPromise = (async () => {
    const config = readNavlungoRuntimeConfig(environment);
    ensureNavlungoBaseCredentials(config);

    const connection = await getNavlungoConnection(environment);
    if (!connection?.refresh_token) {
      throw new Error("Navlungo shared account is not connected yet. Complete admin authorization first.");
    }

    if (!force && connection.access_token && connection.access_token_expires_at) {
      const expiresAtMs = new Date(connection.access_token_expires_at).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
        primeNavlungoAccessTokenCache({
          environment,
          accessToken: connection.access_token,
          expiresAt: connection.access_token_expires_at,
        });
        return connection.access_token;
      }
    }

    const refreshed = await refreshNavlungoAccessToken({
      refreshToken: connection.refresh_token,
      environment,
    });

    const accessTokenExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString();

    await upsertNavlungoConnection({
      environment,
      clientId: config.clientId,
      refreshToken: refreshed.refreshToken ?? connection.refresh_token,
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt,
      connectedEmail: connection.connected_email,
      connectedAt: connection.connected_at,
      createdBy: connection.created_by,
      updatedBy: connection.updated_by,
    });

    primeNavlungoAccessTokenCache({
      environment,
      accessToken: refreshed.accessToken,
      expiresInSeconds: refreshed.expiresInSeconds,
    });

    return refreshed.accessToken;
  })().finally(() => {
    tokenInFlight.delete(environment);
  });

  tokenInFlight.set(environment, refreshPromise);
  return refreshPromise;
};

const requestJson = async <T>(args: {
  method: HttpMethod;
  path: string;
  body?: unknown;
  returnNullOn404?: boolean;
}): Promise<T | null> => {
  const config = readNavlungoRuntimeConfig();
  ensureNavlungoBaseCredentials(config);

  const execute = async (accessToken: string) => {
    return withTimeout(async (signal) => {
      const response = await fetch(`${config.apiBaseUrl}${args.path}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal,
      });

      if (args.returnNullOn404 && response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw await parseApiError(response);
      }

      if (response.status === 204) {
        return null as T | null;
      }

      return (await response.json()) as T;
    }, config.timeoutMs);
  };

  const environment = config.environment;
  let accessToken = await refreshSharedAccessToken(environment, false);

  try {
    return await execute(accessToken);
  } catch (error) {
    if (error instanceof NavlungoApiError && error.status === 401) {
      clearNavlungoAccessTokenCache(environment);
      accessToken = await refreshSharedAccessToken(environment, true);
      return execute(accessToken);
    }

    throw error;
  }
};

export const isNavlungoConfigured = () => hasNavlungoBaseCredentials();

export const createNavlungoOrderQuote = async (args: {
  storeId: string;
  payload: NavlungoOrderQuoteRequest;
}) => {
  return requestJson<NavlungoOrderQuoteResponse>({
    method: "POST",
    path: `/stores/v2/${encodeURIComponent(args.storeId)}/orders`,
    body: args.payload,
  }) as Promise<NavlungoOrderQuoteResponse>;
};

export const createNavlungoStore = async (args: {
  payload: NavlungoCreateStoreRequest;
}) => {
  return requestJson<NavlungoCreateStoreResponse>({
    method: "POST",
    path: "/stores/v1",
    body: args.payload,
  }) as Promise<NavlungoCreateStoreResponse>;
};

export const shipNavlungoStoreOrder = async (args: {
  storeId: string;
  orderReference: string;
  payload: NavlungoShipStoreOrderRequest;
}) => {
  return requestJson<NavlungoShipStoreOrderResponse>({
    method: "POST",
    path: `/stores/v2/${encodeURIComponent(args.storeId)}/orders/${encodeURIComponent(args.orderReference)}/ship`,
    body: args.payload,
  }) as Promise<NavlungoShipStoreOrderResponse>;
};

export const createNavlungoShipmentLabel = async (args: {
  shipmentId: string;
}) => {
  return requestJson<NavlungoCreateShipmentLabelResponse>({
    method: "POST",
    path: `/api/shipments/v1/${encodeURIComponent(args.shipmentId)}/label`,
  }) as Promise<NavlungoCreateShipmentLabelResponse>;
};

export const getNavlungoShipmentLabel = async (args: {
  shipmentId: string;
}) => {
  return requestJson<NavlungoShipmentLabelResponse>({
    method: "GET",
    path: `/api/shipments/v1/${encodeURIComponent(args.shipmentId)}/label`,
    returnNullOn404: true,
  });
};

export const getNavlungoStoreOrderTracking = async (args: {
  storeId: string;
  orderReference: string;
}) => {
  return requestJson<NavlungoStoreOrderTrackingResponse>({
    method: "GET",
    path: `/stores/v1/${encodeURIComponent(args.storeId)}/ordertracking?orderReference=${encodeURIComponent(args.orderReference)}`,
    returnNullOn404: true,
  });
};

export const getNavlungoShipmentTracking = async (args: {
  reference: string;
}) => {
  return requestJson<NavlungoShipmentTrackingResponse>({
    method: "GET",
    path: `/api/shipments/v1/${encodeURIComponent(args.reference)}/tracking`,
    returnNullOn404: true,
  });
};
