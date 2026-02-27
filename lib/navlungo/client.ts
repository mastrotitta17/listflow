const DEFAULT_BASE_URL = "https://api.navlungo.com";
const TOKEN_PATH = "/v1/oauth/token";
const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;

type HttpMethod = "GET" | "POST";

type NavlungoRuntimeConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string | null;
  timeoutMs: number;
};

type TokenCache = {
  token: string;
  expiresAt: number;
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

let tokenCache: TokenCache | null = null;
let tokenInFlight: Promise<string> | null = null;

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

const readConfig = (): NavlungoRuntimeConfig => {
  const baseUrl = (process.env.NAVLUNGO_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const clientId = (process.env.NAVLUNGO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.NAVLUNGO_CLIENT_SECRET ?? "").trim();
  const scopeRaw = (process.env.NAVLUNGO_SCOPE ?? "").trim();
  const timeoutMs = asPositiveInt(process.env.NAVLUNGO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    clientId,
    clientSecret,
    scope: scopeRaw || null,
    timeoutMs,
  };
};

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

const parseAccessTokenResponse = async (response: Response) => {
  if (!response.ok) {
    throw await parseApiError(response);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: string | number;
  };

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
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
    expiresInSeconds: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 300,
  };
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

const getAccessToken = async (config: NavlungoRuntimeConfig) => {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = withTimeout(async (signal) => {
    const form = new URLSearchParams();
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
    form.set("grant_type", "client_credentials");
    if (config.scope) {
      form.set("scope", config.scope);
    }

    const response = await fetch(`${config.baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal,
    });

    const parsed = await parseAccessTokenResponse(response);
    const expiresAt = Date.now() + Math.max(parsed.expiresInSeconds - TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS, 10) * 1000;

    tokenCache = {
      token: parsed.accessToken,
      expiresAt,
    };

    return parsed.accessToken;
  }, config.timeoutMs).finally(() => {
    tokenInFlight = null;
  });

  return tokenInFlight;
};

const requestJson = async <T>(args: {
  method: HttpMethod;
  path: string;
  config: NavlungoRuntimeConfig;
  body?: unknown;
}): Promise<T> => {
  const accessToken = await getAccessToken(args.config);

  return withTimeout(async (signal) => {
    const response = await fetch(`${args.config.baseUrl}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal,
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return (await response.json()) as T;
  }, args.config.timeoutMs);
};

export const isNavlungoConfigured = () => {
  const { clientId, clientSecret } = readConfig();
  return Boolean(clientId && clientSecret);
};

export const createNavlungoOrderQuote = async (args: {
  storeId: string;
  payload: NavlungoOrderQuoteRequest;
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("Navlungo credentials are missing. Set NAVLUNGO_CLIENT_ID and NAVLUNGO_CLIENT_SECRET.");
  }

  return requestJson<NavlungoOrderQuoteResponse>({
    method: "POST",
    config,
    path: `/stores/v2/${encodeURIComponent(args.storeId)}/orders`,
    body: args.payload,
  });
};

export const createNavlungoStore = async (args: {
  payload: NavlungoCreateStoreRequest;
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("Navlungo credentials are missing. Set NAVLUNGO_CLIENT_ID and NAVLUNGO_CLIENT_SECRET.");
  }

  return requestJson<NavlungoCreateStoreResponse>({
    method: "POST",
    config,
    path: "/stores/v1",
    body: args.payload,
  });
};

export const shipNavlungoStoreOrder = async (args: {
  storeId: string;
  orderReference: string;
  payload: NavlungoShipStoreOrderRequest;
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("Navlungo credentials are missing. Set NAVLUNGO_CLIENT_ID and NAVLUNGO_CLIENT_SECRET.");
  }

  return requestJson<NavlungoShipStoreOrderResponse>({
    method: "POST",
    config,
    path: `/stores/v2/${encodeURIComponent(args.storeId)}/orders/${encodeURIComponent(args.orderReference)}/ship`,
    body: args.payload,
  });
};
