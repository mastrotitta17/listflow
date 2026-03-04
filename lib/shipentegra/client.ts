const DEFAULT_BASE_URL = "https://publicapi.shipentegra.com/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;

type HttpMethod = "GET" | "POST";

type ShipentegraRuntimeConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

type ApiEnvelope<T> = {
  status?: string;
  time?: string;
  code?: number;
  data?: T;
};

type ApiErrorEnvelope = {
  status?: string;
  time?: string;
  code?: number;
  data?: Array<{
    message?: string;
    description?: string;
  }>;
};

export type ShipentegraOrderManualPayload = {
  number?: string;
  packageQuantity: number;
  description: string;
  service?: 1 | 2;
  currency: string;
  weight?: number;
  width?: number;
  height?: number;
  length?: number;
  reference1?: string;
  iossNumber?: string;
  shippingType?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shippingAddress: {
    name: string;
    address: string;
    city: string;
    country: string;
    state?: string;
    postalCode: string;
    phone?: string;
    email?: string;
    town?: string;
  };
  items: Array<{
    quantity: number;
    unitPrice: number;
    name: string;
    sku?: string;
    gtip?: string;
    imageUrl?: string;
  }>;
};

export type ShipentegraOrderMultiPayload = {
  currency: string;
  description: string;
  vatNumber?: string;
  orderNumber?: string;
  reference?: string;
  shippingType?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shipTo: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    state?: string;
    zipCode: string;
    country: string;
    phone?: string;
    email?: string;
  };
  shipFrom: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    state?: string;
    zipCode: string;
    country: string;
    phone?: string;
    email?: string;
  };
  products: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineItemKey?: string;
    hsCode?: string;
    sku?: string;
    imageUrl?: string;
    options?: Array<{ name: string; value: string }>;
  }>;
  packages: Array<{
    width: number;
    height: number;
    length: number;
    weight: number;
    packageQuantity: number;
  }>;
};

export type ShipentegraLabelPayload = {
  orderId: number;
  specialService?: string;
  verpackg?: -1 | 1 | 2;
  insurance?: boolean;
  content?: string;
  weight?: number;
  iossNumber?: string;
  currency?: string;
};

export type ShipentegraCreateOrderResult = {
  success?: boolean;
  orderId?: number | string;
  shipEntegraOrderId?: number | string;
  description?: string;
  [key: string]: unknown;
};

export type ShipentegraCreateLabelResult = {
  success?: boolean;
  orderId?: number | string;
  message?: string;
  label?: string;
  invoice?: string;
  trackingNumber?: string;
  [key: string]: unknown;
};

export class ShipentegraApiError extends Error {
  public readonly status: number;
  public readonly apiCode: number | null;
  public readonly details: Record<string, unknown> | null;

  constructor(message: string, args: { status: number; apiCode?: number | null; details?: Record<string, unknown> | null }) {
    super(message);
    this.name = "ShipentegraApiError";
    this.status = args.status;
    this.apiCode = args.apiCode ?? null;
    this.details = args.details ?? null;
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

const parseValidityToExpiresAt = (raw: unknown) => {
  if (typeof raw === "string") {
    const asMs = Date.parse(raw);
    if (Number.isFinite(asMs) && asMs > Date.now()) {
      return asMs;
    }

    const asSeconds = Number(raw);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Date.now() + asSeconds * 1000;
    }
  }

  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Date.now() + raw * 1000;
  }

  return Date.now() + 10 * 60 * 1000;
};

const readConfig = (): ShipentegraRuntimeConfig => {
  const baseUrl = (process.env.SHIPENTEGRA_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const clientId = (process.env.SHIPENTEGRA_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SHIPENTEGRA_CLIENT_SECRET ?? "").trim();
  const timeoutMs = asPositiveInt(process.env.SHIPENTEGRA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    clientId,
    clientSecret,
    timeoutMs,
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
      throw new Error(`ShipEntegra request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseApiError = async (response: Response): Promise<ShipentegraApiError> => {
  const text = await response.text();
  let parsed: ApiErrorEnvelope | null = null;

  if (text) {
    try {
      parsed = JSON.parse(text) as ApiErrorEnvelope;
    } catch {
      parsed = null;
    }
  }

  const firstError = parsed?.data?.[0];
  const message =
    firstError?.description ||
    firstError?.message ||
    (text && !parsed ? text : null) ||
    `ShipEntegra request failed with HTTP ${response.status}`;

  return new ShipentegraApiError(message, {
    status: response.status,
    apiCode: typeof parsed?.code === "number" ? parsed.code : null,
    details: parsed ? (parsed as unknown as Record<string, unknown>) : null,
  });
};

const parseTokenResponse = async (response: Response) => {
  if (!response.ok) {
    throw await parseApiError(response);
  }

  const envelope = (await response.json()) as ApiEnvelope<{
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    accessTokenValidity?: string | number;
  }>;

  const accessToken = typeof envelope.data?.accessToken === "string" ? envelope.data.accessToken.trim() : "";

  if (!accessToken) {
    throw new Error("ShipEntegra token response does not include accessToken");
  }

  const rawExpiresAt = envelope.data?.accessTokenValidity;
  const expiresAtRawMs = parseValidityToExpiresAt(rawExpiresAt);
  const expiresAt = expiresAtRawMs - TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS * 1000;

  return {
    accessToken,
    expiresAt: Math.max(expiresAt, Date.now() + 10_000),
  };
};

const getAccessToken = async (config: ShipentegraRuntimeConfig) => {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = withTimeout(async (signal) => {
    const response = await fetch(`${config.baseUrl}/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      }),
      signal,
    });

    const parsed = await parseTokenResponse(response);
    tokenCache = {
      token: parsed.accessToken,
      expiresAt: parsed.expiresAt,
    };
    return parsed.accessToken;
  }, config.timeoutMs).finally(() => {
    tokenInFlight = null;
  });

  return tokenInFlight;
};

const requestApi = async <T>(args: {
  method: HttpMethod;
  path: string;
  config: ShipentegraRuntimeConfig;
  body?: unknown;
  language?: "tr" | "en";
}): Promise<T> => {
  const accessToken = await getAccessToken(args.config);

  return withTimeout(async (signal) => {
    const response = await fetch(`${args.config.baseUrl}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(args.language ? { "Accept-Language": args.language } : {}),
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal,
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data as T;
  }, args.config.timeoutMs);
};

export const isShipentegraConfigured = () => {
  const { clientId, clientSecret } = readConfig();
  return Boolean(clientId && clientSecret);
};

export const createShipentegraOrderMulti = async (args: {
  payload: ShipentegraOrderMultiPayload;
  language?: "tr" | "en";
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("ShipEntegra credentials are missing. Set SHIPENTEGRA_CLIENT_ID and SHIPENTEGRA_CLIENT_SECRET.");
  }

  return requestApi<ShipentegraCreateOrderResult>({
    method: "POST",
    config,
    path: "/orders",
    body: args.payload,
    language: args.language,
  });
};

export const createShipentegraOrderManual = async (args: {
  payload: ShipentegraOrderManualPayload;
  language?: "tr" | "en";
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("ShipEntegra credentials are missing. Set SHIPENTEGRA_CLIENT_ID and SHIPENTEGRA_CLIENT_SECRET.");
  }

  return requestApi<ShipentegraCreateOrderResult>({
    method: "POST",
    config,
    path: "/orders/manual",
    body: args.payload,
    language: args.language,
  });
};

export const createShipentegraLabel = async (args: {
  payload: ShipentegraLabelPayload;
  language?: "tr" | "en";
}) => {
  const config = readConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("ShipEntegra credentials are missing. Set SHIPENTEGRA_CLIENT_ID and SHIPENTEGRA_CLIENT_SECRET.");
  }

  return requestApi<ShipentegraCreateLabelResult>({
    method: "POST",
    config,
    path: "/logistics/labels/shipentegra",
    body: args.payload,
    language: args.language,
  });
};
