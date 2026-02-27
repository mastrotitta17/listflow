import {
  NavlungoApiError,
  createNavlungoStore,
  createNavlungoOrderQuote,
  isNavlungoConfigured,
  shipNavlungoStoreOrder,
  type NavlungoOrderQuoteRequest,
  type NavlungoStoreAddress,
} from "@/lib/navlungo/client";

export type StartNavlungoShipmentInput = {
  orderId: string;
  localStoreId: string;
  navlungoStoreId?: string | null;
  storeName?: string | null;
  storePhone?: string | null;
  userEmail?: string | null;
  userFullName?: string | null;
  userPhone?: string | null;
  categoryName: string;
  subProductName: string;
  variantName?: string | null;
  shippingAddress: string;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverCountryCode?: string | null;
  receiverState?: string | null;
  receiverCity?: string | null;
  receiverTown?: string | null;
  receiverPostalCode?: string | null;
  labelNumber: string;
  amountUsd: number;
  currency?: string | null;
};

export type NavlungoShipmentDispatchResult =
  | {
      status: "started";
      storeId: string;
      searchId: string;
      quoteReference: string;
      shipmentId: string;
      shipmentReference: string;
      trackingUrl: string;
      response: Record<string, unknown>;
      message: string;
    }
  | {
      status: "skipped";
      reason:
        | "NAVLUNGO_DISABLED"
        | "MISSING_RECEIVER_PHONE"
        | "MISSING_RECEIVER_ADDRESS"
        | "MISSING_STORE_ID";
      message: string;
      response?: Record<string, unknown>;
    }
  | {
      status: "failed";
      reason: "QUOTE_FAILED" | "SHIPMENT_FAILED" | "UNEXPECTED_ERROR";
      message: string;
      response?: Record<string, unknown>;
    };

const FIXED_NAVLUNGO_SENDER = {
  contactName: "Teoman Demirbaş",
  contactPhone: "+905449420223",
  identificationNumber: "23083558206",
  contactMail: "demirteo2@gmail.com",
  firstLine: "Fulya Mah. Özlüce Sok. No 20 D13 Şişli/İstanbul",
  countryCode: "TR",
  city: "İstanbul",
  town: "Şişli",
  postalCode: "34394",
} as const;

const readEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const readNumberEnv = (key: string, fallback: number) => {
  const raw = readEnv(key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeCountryCode = (value: string | null | undefined, fallback = "US") => {
  const candidate = (value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(candidate)) {
    return candidate;
  }

  return fallback;
};

const normalizeCurrencyCode = (value: string | null | undefined) => {
  const candidate = (value ?? "").trim().toUpperCase();
  if (candidate === "TRY") {
    return "TRY";
  }

  return "USD";
};

const normalizePhone = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const digits = trimmed.replace(/[^\d+]/g, "");
  if (!digits) {
    return "";
  }

  if (digits.startsWith("+")) {
    return digits;
  }

  return `+${digits}`;
};

const pickAddressSegment = (segments: string[], indexFromEnd: number, fallback: string) => {
  const index = segments.length - 1 - indexFromEnd;
  if (index >= 0 && segments[index]) {
    return segments[index];
  }

  return fallback;
};

const parseReceiverAddressFromText = (rawAddress: string, fallbackContactName: string, fallbackCountryCode: string) => {
  const compact = rawAddress
    .replace(/\r/g, "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

  if (!compact) {
    return null;
  }

  const commaParts = compact
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const postalMatch = compact.match(/\b\d{4,10}\b/);
  const detectedCountryCode = commaParts
    .map((part) => part.trim().toUpperCase())
    .find((part) => /^[A-Z]{2}$/.test(part));

  const fallbackCity = readEnv("NAVLUNGO_DEFAULT_DEST_CITY") ?? "Istanbul";
  const fallbackTown = readEnv("NAVLUNGO_DEFAULT_DEST_TOWN") ?? fallbackCity;
  const fallbackPostalCode = readEnv("NAVLUNGO_DEFAULT_DEST_POSTAL_CODE") ?? "34000";
  const fallbackState = readEnv("NAVLUNGO_DEFAULT_DEST_STATE");

  const city = pickAddressSegment(commaParts, 2, fallbackCity);
  const town = pickAddressSegment(commaParts, 1, fallbackTown);
  const firstLine =
    commaParts.slice(0, Math.max(commaParts.length - 2, 1)).join(", ").slice(0, 120) || compact.slice(0, 120);

  const contactNameCandidate = commaParts[0] ?? "";
  const contactName = contactNameCandidate.length >= 3 ? contactNameCandidate.slice(0, 80) : fallbackContactName;

  return {
    contactName: contactName || "Listflow Customer",
    countryCode: normalizeCountryCode(
      detectedCountryCode,
      normalizeCountryCode(readEnv("NAVLUNGO_DEFAULT_DEST_COUNTRY"), fallbackCountryCode)
    ),
    state: fallbackState ?? undefined,
    town: town.slice(0, 80),
    city: city.slice(0, 80),
    postalCode: (postalMatch?.[0] ?? fallbackPostalCode).slice(0, 20),
    firstLine: firstLine.slice(0, 120),
  };
};

const resolveReceiverAddress = (args: {
  input: StartNavlungoShipmentInput;
  fallbackContactName: string;
  fallbackCountryCode: string;
}) => {
  const parsedFromText = parseReceiverAddressFromText(
    args.input.shippingAddress,
    args.fallbackContactName,
    args.fallbackCountryCode
  );

  if (!parsedFromText) {
    return null;
  }

  const explicitCountryCode = normalizeCountryCode(args.input.receiverCountryCode, "");
  const explicitState = (args.input.receiverState ?? "").trim();
  const explicitCity = (args.input.receiverCity ?? "").trim();
  const explicitTown = (args.input.receiverTown ?? "").trim();
  const explicitPostalCode = (args.input.receiverPostalCode ?? "").trim();
  const explicitFirstLine = (args.input.shippingAddress ?? "").trim().slice(0, 120);
  const explicitContactName = (args.input.receiverName ?? "").trim();

  return {
    contactName: explicitContactName || parsedFromText.contactName || "Listflow Customer",
    countryCode: explicitCountryCode || parsedFromText.countryCode,
    state: explicitState || parsedFromText.state,
    town: (explicitTown || parsedFromText.town).slice(0, 80),
    city: (explicitCity || parsedFromText.city).slice(0, 80),
    postalCode: (explicitPostalCode || parsedFromText.postalCode).slice(0, 20),
    firstLine: (explicitFirstLine || parsedFromText.firstLine).slice(0, 120),
  };
};

const sanitizeSku = (value: string, fallback: string) => {
  const normalized = value.replace(/\s+/g, "").replace(/[^a-zA-Z0-9\-_]/g, "");
  if (normalized) {
    return normalized.slice(0, 80);
  }

  return fallback.slice(0, 80);
};

const mapShipmentType = () => {
  const raw = (readEnv("NAVLUNGO_SHIPMENT_TYPE") ?? "sales").toLowerCase();
  if (raw === "sample" || raw === "micro-export" || raw === "gift") {
    return raw;
  }

  return "sales";
};

const parseAdditionalServices = (quote: { additionalServices?: Array<{ serviceCode?: string; isRequired?: boolean }> }) => {
  const required = (quote.additionalServices ?? [])
    .filter((service) => service.isRequired)
    .map((service) => (service.serviceCode ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(required));
};

const buildFixedSenderAddress = (): NavlungoStoreAddress => {
  return {
    type: "Individual",
    identificationNumber: FIXED_NAVLUNGO_SENDER.identificationNumber,
    contactName: FIXED_NAVLUNGO_SENDER.contactName,
    contactPhone: FIXED_NAVLUNGO_SENDER.contactPhone,
    contactMail: FIXED_NAVLUNGO_SENDER.contactMail,
    countryCode: FIXED_NAVLUNGO_SENDER.countryCode,
    city: FIXED_NAVLUNGO_SENDER.city,
    town: FIXED_NAVLUNGO_SENDER.town,
    postalCode: FIXED_NAVLUNGO_SENDER.postalCode,
    firstLine: FIXED_NAVLUNGO_SENDER.firstLine,
  };
};

const isAlreadyExistsStoreError = (error: NavlungoApiError) => {
  const combined = `${error.problemCode ?? ""} ${error.details.title ?? ""} ${error.details.detail ?? ""}`.toLowerCase();
  return (
    combined.includes("already") ||
    combined.includes("exist") ||
    combined.includes("duplicate") ||
    combined.includes("zaten")
  );
};

const ensureNavlungoStoreId = async (input: StartNavlungoShipmentInput) => {
  const explicitStoreId = (input.navlungoStoreId ?? "").trim();
  if (explicitStoreId) {
    return {
      storeId: explicitStoreId,
      storeProvisioned: false,
    };
  }

  const localStoreId = (input.localStoreId ?? "").trim();
  if (!localStoreId) {
    return {
      storeId: "",
      storeProvisioned: false,
    };
  }

  const senderAddress = buildFixedSenderAddress();
  const resolvedStoreName =
    (input.storeName ?? "").trim() || `Listflow Store ${localStoreId.slice(0, 8)}`;

  try {
    const createdStore = await createNavlungoStore({
      payload: {
        name: resolvedStoreName,
        storeId: localStoreId,
        storeAddress: senderAddress,
        invoiceAddress: senderAddress,
      },
    });

    return {
      storeId: (createdStore.storeId ?? localStoreId).trim() || localStoreId,
      storeProvisioned: true,
    };
  } catch (error) {
    if (error instanceof NavlungoApiError && isAlreadyExistsStoreError(error)) {
      return {
        storeId: localStoreId,
        storeProvisioned: false,
      };
    }

    throw error;
  }
};

const buildQuotePayload = (args: {
  orderReference: string;
  input: StartNavlungoShipmentInput;
  receiverAddress: {
    contactName: string;
    countryCode: string;
    state?: string;
    town: string;
    city: string;
    postalCode: string;
    firstLine: string;
  };
  receiverPhone: string;
}) => {
  const hsCode = readEnv("NAVLUNGO_DEFAULT_HS_CODE") ?? "491199";
  const packageType = readEnv("NAVLUNGO_DEFAULT_PACKAGE_TYPE") ?? "box";
  const packageWeight = readNumberEnv("NAVLUNGO_DEFAULT_PACKAGE_WEIGHT_KG", 0.5);
  const packageWidth = readNumberEnv("NAVLUNGO_DEFAULT_PACKAGE_WIDTH_CM", 20);
  const packageLength = readNumberEnv("NAVLUNGO_DEFAULT_PACKAGE_LENGTH_CM", 30);
  const packageHeight = readNumberEnv("NAVLUNGO_DEFAULT_PACKAGE_HEIGHT_CM", 5);

  const productDescription = args.input.variantName
    ? `${args.input.subProductName} - ${args.input.variantName}`
    : args.input.subProductName;

  const orderItemDescription = `${args.input.categoryName} | ${productDescription}`.slice(0, 200);

  const payload: NavlungoOrderQuoteRequest = {
    order: {
      orderReference: args.orderReference,
      currencyCode: normalizeCurrencyCode(args.input.currency),
      receiverAddress: args.receiverAddress,
      receiverEmail: args.input.userEmail ?? undefined,
      receiverPhoneNumber: args.receiverPhone,
      orderItems: [
        {
          quantity: 1,
          price: args.input.amountUsd.toFixed(2),
          description: orderItemDescription,
          sku: sanitizeSku(args.input.labelNumber, `order-${args.input.orderId}`),
          hsCode,
        },
      ],
    },
    packages: [
      {
        quantity: 1,
        type: packageType,
        weight: packageWeight,
        width: packageWidth,
        length: packageLength,
        height: packageHeight,
      },
    ],
    shipmentType: mapShipmentType(),
  };

  return payload;
};

export const startNavlungoShipmentForOrder = async (
  input: StartNavlungoShipmentInput
): Promise<NavlungoShipmentDispatchResult> => {
  if (!isNavlungoConfigured()) {
    return {
      status: "skipped",
      reason: "NAVLUNGO_DISABLED",
      message: "Navlungo credentials are not configured.",
    };
  }

  const { storeId: resolvedStoreId, storeProvisioned } = await ensureNavlungoStoreId(input);
  if (!resolvedStoreId) {
    return {
      status: "skipped",
      reason: "MISSING_STORE_ID",
      message: "Order store id could not be resolved for Navlungo shipment.",
    };
  }

  const addressSource = input.shippingAddress.trim();
  if (!addressSource) {
    return {
      status: "skipped",
      reason: "MISSING_RECEIVER_ADDRESS",
      message: "Shipping address is required to create Navlungo shipment.",
    };
  }

  const receiverPhone =
    normalizePhone(input.receiverPhone) ||
    normalizePhone(input.storePhone) ||
    normalizePhone(input.userPhone) ||
    normalizePhone(readEnv("NAVLUNGO_DEFAULT_RECEIVER_PHONE"));

  if (!receiverPhone) {
    return {
      status: "skipped",
      reason: "MISSING_RECEIVER_PHONE",
      message: "Receiver phone is required for Navlungo shipment.",
    };
  }

  const fallbackContactName = (input.userFullName ?? input.storeName ?? "Listflow Customer").trim();
  const receiverAddress = resolveReceiverAddress({
    input,
    fallbackContactName,
    fallbackCountryCode: normalizeCountryCode(readEnv("NAVLUNGO_DEFAULT_DEST_COUNTRY"), "US"),
  });

  if (!receiverAddress) {
    return {
      status: "skipped",
      reason: "MISSING_RECEIVER_ADDRESS",
      message: "Shipping address could not be parsed for Navlungo shipment.",
    };
  }

  const orderReference = input.orderId;

  try {
    const quotePayload = buildQuotePayload({
      orderReference,
      input,
      receiverAddress,
      receiverPhone,
    });

    const quoteResponse = await createNavlungoOrderQuote({
      storeId: resolvedStoreId,
      payload: quotePayload,
    });

    const quote = quoteResponse.quotes?.[0];
    if (!quote?.quoteReference) {
      return {
        status: "failed",
        reason: "QUOTE_FAILED",
        message: "Navlungo quote response does not include a selectable quote.",
        response: {
          searchId: quoteResponse.searchId,
          quotes: quoteResponse.quotes ?? [],
        },
      };
    }

    const selectedAdditionalServices = parseAdditionalServices(quote);

    const shipResponse = await shipNavlungoStoreOrder({
      storeId: resolvedStoreId,
      orderReference,
      payload: {
        quoteReference: quote.quoteReference,
        searchId: quoteResponse.searchId,
        selectedAdditionalServices,
      },
    });

    return {
      status: "started",
      storeId: resolvedStoreId,
      searchId: quoteResponse.searchId,
      quoteReference: quote.quoteReference,
      shipmentId: shipResponse.shipmentId,
      shipmentReference: shipResponse.shipmentReference,
      trackingUrl: shipResponse.trackingUrl,
      response: {
        selectedAdditionalServices,
        cargoLabels: shipResponse.cargoLabels ?? [],
        chargeableWeight: shipResponse.chargeableWeight ?? null,
        senderProfileFixed: true,
        storeProvisioned,
      },
      message: "Navlungo shipment started successfully.",
    };
  } catch (error) {
    if (error instanceof NavlungoApiError) {
      const isQuotePath = (error.details.path ?? "").includes("/stores/v2/") &&
        !(error.details.path ?? "").includes("/ship");

      return {
        status: "failed",
        reason: isQuotePath ? "QUOTE_FAILED" : "SHIPMENT_FAILED",
        message: error.message,
        response: {
          status: error.status,
          problemCode: error.problemCode,
          detail: error.details.detail ?? null,
          path: error.details.path ?? null,
          title: error.details.title ?? null,
          type: error.details.type ?? null,
          extensions: error.details.extensions ?? null,
        },
      };
    }

    return {
      status: "failed",
      reason: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : "Unexpected Navlungo error",
    };
  }
};
