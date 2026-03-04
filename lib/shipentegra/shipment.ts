import {
  ShipentegraApiError,
  createShipentegraLabel,
  createShipentegraOrderManual,
  createShipentegraOrderMulti,
  isShipentegraConfigured,
  type ShipentegraOrderManualPayload,
  type ShipentegraOrderMultiPayload,
} from "@/lib/shipentegra/client";

export type StartShipentegraShipmentInput = {
  orderId: string;
  localStoreId: string;
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
  ioss?: string | null;
};

export type ShipentegraShipmentDispatchResult =
  | {
      status: "started";
      orderId: number;
      trackingNumber: string | null;
      labelUrl: string | null;
      invoiceUrl: string | null;
      response: Record<string, unknown>;
      message: string;
    }
  | {
      status: "skipped";
      reason:
        | "SHIPENTEGRA_DISABLED"
        | "MISSING_RECEIVER_PHONE"
        | "MISSING_RECEIVER_ADDRESS"
        | "MISSING_STORE_ID"
        | "AWAITING_PAYMENT";
      message: string;
      response?: Record<string, unknown>;
    }
  | {
      status: "failed";
      reason: "ORDER_CREATE_FAILED" | "LABEL_CREATE_FAILED" | "UNEXPECTED_ERROR";
      message: string;
      response?: Record<string, unknown>;
    };

const FALLBACK_SENDER = {
  name: "Teoman Demirbas",
  phone: "+905449420223",
  email: "demirteo2@gmail.com",
  address1: "Fulya Mah. Ozluce Sok. No 20 D13 Sisli",
  city: "Istanbul",
  state: "Istanbul",
  zipCode: "34394",
  country: "TR",
} as const;

const readEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const readNumberEnv = (keys: string[], fallback: number) => {
  for (const key of keys) {
    const raw = readEnv(key);
    if (!raw) {
      continue;
    }

    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
};

const clamp = (value: string, max: number) => value.slice(0, max);

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
  if (candidate === "EUR") {
    return "EUR";
  }
  if (candidate === "GBP") {
    return "GBP";
  }
  return "USD";
};

const normalizePhone = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/[^\d+\-()\s]/g, "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("+")) {
    return clamp(normalized, 32);
  }

  return clamp(`+${normalized}`, 32);
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

  const postalMatch = compact.match(/\b[0-9A-Za-z\- ]{3,15}\b/);
  const detectedCountryCode = commaParts
    .map((part) => part.trim().toUpperCase())
    .find((part) => /^[A-Z]{2}$/.test(part));

  const fallbackCity = readEnv("SHIPENTEGRA_DEFAULT_DEST_CITY") ?? readEnv("NAVLUNGO_DEFAULT_DEST_CITY") ?? "Istanbul";
  const fallbackTown = readEnv("SHIPENTEGRA_DEFAULT_DEST_TOWN") ?? readEnv("NAVLUNGO_DEFAULT_DEST_TOWN") ?? fallbackCity;
  const fallbackPostalCode =
    readEnv("SHIPENTEGRA_DEFAULT_DEST_POSTAL_CODE") ?? readEnv("NAVLUNGO_DEFAULT_DEST_POSTAL_CODE") ?? "34000";
  const fallbackState = readEnv("SHIPENTEGRA_DEFAULT_DEST_STATE") ?? readEnv("NAVLUNGO_DEFAULT_DEST_STATE");

  const city = pickAddressSegment(commaParts, 2, fallbackCity);
  const town = pickAddressSegment(commaParts, 1, fallbackTown);
  const address1 =
    commaParts.slice(0, Math.max(commaParts.length - 2, 1)).join(", ").slice(0, 35) || compact.slice(0, 35);

  const contactNameCandidate = commaParts[0] ?? "";
  const contactName = contactNameCandidate.length >= 3 ? clamp(contactNameCandidate, 50) : fallbackContactName;

  return {
    name: contactName || "Listflow Customer",
    country: normalizeCountryCode(
      detectedCountryCode,
      normalizeCountryCode(readEnv("SHIPENTEGRA_DEFAULT_DEST_COUNTRY") ?? readEnv("NAVLUNGO_DEFAULT_DEST_COUNTRY"), fallbackCountryCode)
    ),
    state: fallbackState ?? undefined,
    town: clamp(town, 35),
    city: clamp(city, 35),
    postalCode: clamp((postalMatch?.[0] ?? fallbackPostalCode).replace(/\s+/g, " "), 15),
    address1: clamp(address1, 35),
  };
};

const resolveReceiverAddress = (args: {
  input: StartShipentegraShipmentInput;
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
  const explicitAddress = (args.input.shippingAddress ?? "").trim();
  const explicitContactName = (args.input.receiverName ?? "").trim();

  return {
    name: clamp(explicitContactName || parsedFromText.name || "Listflow Customer", 50),
    country: explicitCountryCode || parsedFromText.country,
    state: clamp(explicitState || parsedFromText.state || "", 35) || undefined,
    town: clamp(explicitTown || parsedFromText.town, 35),
    city: clamp(explicitCity || parsedFromText.city, 35),
    postalCode: clamp(explicitPostalCode || parsedFromText.postalCode, 15),
    address1: clamp(explicitAddress || parsedFromText.address1, 35),
    address2: explicitAddress.length > 35 ? clamp(explicitAddress.slice(35), 35) : undefined,
  };
};

const sanitizeSku = (value: string, fallback: string) => {
  const normalized = value.replace(/\s+/g, "").replace(/[^a-zA-Z0-9\-_]/g, "");
  if (normalized) {
    return normalized.slice(0, 64);
  }

  return fallback.slice(0, 64);
};

const normalizeShippingType = (ioss: string | null | undefined) => {
  const explicit = readEnv("SHIPENTEGRA_SHIPPING_TYPE");
  if (explicit) {
    const parsed = Number(explicit);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 7) {
      return parsed as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    }
  }

  // If IOSS exists, choose IOSS mode by default.
  if ((ioss ?? "").trim()) {
    return 3;
  }

  return 1;
};

const buildShipFrom = () => {
  const name = readEnv("SHIPENTEGRA_SENDER_NAME") ?? FALLBACK_SENDER.name;
  const address1 = readEnv("SHIPENTEGRA_SENDER_ADDRESS1") ?? FALLBACK_SENDER.address1;
  const address2 = readEnv("SHIPENTEGRA_SENDER_ADDRESS2") ?? undefined;
  const city = readEnv("SHIPENTEGRA_SENDER_CITY") ?? FALLBACK_SENDER.city;
  const state = readEnv("SHIPENTEGRA_SENDER_STATE") ?? FALLBACK_SENDER.state;
  const zipCode = readEnv("SHIPENTEGRA_SENDER_ZIP") ?? FALLBACK_SENDER.zipCode;
  const country = normalizeCountryCode(readEnv("SHIPENTEGRA_SENDER_COUNTRY"), FALLBACK_SENDER.country);
  const phone = normalizePhone(readEnv("SHIPENTEGRA_SENDER_PHONE") ?? FALLBACK_SENDER.phone) || undefined;
  const email = clamp((readEnv("SHIPENTEGRA_SENDER_EMAIL") ?? FALLBACK_SENDER.email).toLowerCase(), 60);

  return {
    name: clamp(name, 50),
    address1: clamp(address1, 35),
    address2: address2 ? clamp(address2, 35) : undefined,
    city: clamp(city, 35),
    state: clamp(state, 35),
    zipCode: clamp(zipCode, 15),
    country,
    phone,
    email,
  };
};

const resolveCreatedOrderId = (payload: Record<string, unknown>) => {
  const candidateValues = [
    payload.orderId,
    payload.shipEntegraOrderId,
    (payload.data as Record<string, unknown> | undefined)?.orderId,
    (payload.data as Record<string, unknown> | undefined)?.shipEntegraOrderId,
  ];

  for (const candidate of candidateValues) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  return null;
};

const buildOrderDescription = (input: StartShipentegraShipmentInput) => {
  const productDescription = input.variantName ? `${input.subProductName} - ${input.variantName}` : input.subProductName;
  return clamp(`${input.categoryName} | ${productDescription}`, 50);
};

const buildCommonOrderData = (input: StartShipentegraShipmentInput) => {
  const receiverPhone =
    normalizePhone(input.receiverPhone) ||
    normalizePhone(input.storePhone) ||
    normalizePhone(input.userPhone) ||
    normalizePhone(readEnv("SHIPENTEGRA_DEFAULT_RECEIVER_PHONE") ?? readEnv("NAVLUNGO_DEFAULT_RECEIVER_PHONE"));

  if (!receiverPhone) {
    return {
      error: {
        status: "skipped" as const,
        reason: "MISSING_RECEIVER_PHONE" as const,
        message: "Receiver phone is required for ShipEntegra shipment.",
      },
    };
  }

  const fallbackContactName = (input.userFullName ?? input.storeName ?? "Listflow Customer").trim();
  const receiverAddress = resolveReceiverAddress({
    input,
    fallbackContactName,
    fallbackCountryCode: normalizeCountryCode(
      readEnv("SHIPENTEGRA_DEFAULT_DEST_COUNTRY") ?? readEnv("NAVLUNGO_DEFAULT_DEST_COUNTRY"),
      "US"
    ),
  });

  if (!receiverAddress) {
    return {
      error: {
        status: "skipped" as const,
        reason: "MISSING_RECEIVER_ADDRESS" as const,
        message: "Shipping address could not be parsed for ShipEntegra shipment.",
      },
    };
  }

  const currency = normalizeCurrencyCode(input.currency);
  const description = buildOrderDescription(input);
  const packageWeight = readNumberEnv(["SHIPENTEGRA_DEFAULT_PACKAGE_WEIGHT_KG", "NAVLUNGO_DEFAULT_PACKAGE_WEIGHT_KG"], 0.5);
  const packageWidth = Math.round(readNumberEnv(["SHIPENTEGRA_DEFAULT_PACKAGE_WIDTH_CM", "NAVLUNGO_DEFAULT_PACKAGE_WIDTH_CM"], 20));
  const packageLength = Math.round(readNumberEnv(["SHIPENTEGRA_DEFAULT_PACKAGE_LENGTH_CM", "NAVLUNGO_DEFAULT_PACKAGE_LENGTH_CM"], 30));
  const packageHeight = Math.round(readNumberEnv(["SHIPENTEGRA_DEFAULT_PACKAGE_HEIGHT_CM", "NAVLUNGO_DEFAULT_PACKAGE_HEIGHT_CM"], 5));
  const shippingType = normalizeShippingType(input.ioss);

  const unitPrice = Math.max(Number(input.amountUsd.toFixed(2)), 0.01);
  const hsCode = readEnv("SHIPENTEGRA_DEFAULT_HS_CODE") ?? readEnv("NAVLUNGO_DEFAULT_HS_CODE") ?? "491199";
  const sku = sanitizeSku(input.labelNumber, `order-${input.orderId}`);
  const imageUrl = readEnv("SHIPENTEGRA_DEFAULT_PRODUCT_IMAGE_URL") ?? undefined;

  return {
    value: {
      receiverPhone,
      receiverAddress,
      currency,
      description,
      packageWeight,
      packageWidth: Math.min(Math.max(packageWidth, 1), 300),
      packageLength: Math.min(Math.max(packageLength, 1), 300),
      packageHeight: Math.min(Math.max(packageHeight, 1), 300),
      shippingType,
      unitPrice,
      hsCode: clamp(hsCode, 20),
      sku,
      imageUrl: imageUrl ? clamp(imageUrl, 255) : undefined,
    },
  };
};

const toLanguage = () => {
  const raw = (readEnv("SHIPENTEGRA_ACCEPT_LANGUAGE") ?? "").toLowerCase();
  if (raw === "en") {
    return "en" as const;
  }
  return "tr" as const;
};

export const startShipentegraShipmentForOrder = async (
  input: StartShipentegraShipmentInput
): Promise<ShipentegraShipmentDispatchResult> => {
  if (!isShipentegraConfigured()) {
    return {
      status: "skipped",
      reason: "SHIPENTEGRA_DISABLED",
      message: "ShipEntegra credentials are not configured.",
    };
  }

  const localStoreId = (input.localStoreId ?? "").trim();
  if (!localStoreId) {
    return {
      status: "skipped",
      reason: "MISSING_STORE_ID",
      message: "Order store id could not be resolved for ShipEntegra shipment.",
    };
  }

  const addressSource = input.shippingAddress.trim();
  if (!addressSource) {
    return {
      status: "skipped",
      reason: "MISSING_RECEIVER_ADDRESS",
      message: "Shipping address is required to create ShipEntegra shipment.",
    };
  }

  const commonResult = buildCommonOrderData(input);
  if ("error" in commonResult && commonResult.error) {
    return commonResult.error;
  }

  if (!("value" in commonResult) || !commonResult.value) {
    return {
      status: "failed",
      reason: "UNEXPECTED_ERROR",
      message: "ShipEntegra common order payload could not be prepared.",
    };
  }

  const common = commonResult.value;
  const shipFrom = buildShipFrom();
  const language = toLanguage();

  const multiPayload: ShipentegraOrderMultiPayload = {
    currency: common.currency,
    description: common.description,
    vatNumber: (input.ioss ?? "").trim() || undefined,
    orderNumber: clamp(input.orderId, 64),
    reference: clamp(input.labelNumber, 48),
    shippingType: common.shippingType,
    shipTo: {
      name: common.receiverAddress.name,
      address1: common.receiverAddress.address1,
      address2: common.receiverAddress.address2,
      city: common.receiverAddress.city,
      state: common.receiverAddress.state,
      zipCode: common.receiverAddress.postalCode,
      country: common.receiverAddress.country,
      phone: common.receiverPhone,
      email: clamp((input.userEmail ?? "").trim().toLowerCase(), 60) || undefined,
    },
    shipFrom,
    products: [
      {
        name: clamp(common.description, 120),
        quantity: 1,
        unitPrice: common.unitPrice,
        lineItemKey: clamp(input.orderId, 64),
        hsCode: common.hsCode,
        sku: common.sku,
        imageUrl: common.imageUrl,
      },
    ],
    packages: [
      {
        width: common.packageWidth,
        height: common.packageHeight,
        length: common.packageLength,
        weight: Math.max(common.packageWeight, 0.1),
        packageQuantity: 1,
      },
    ],
  };

  const manualPayload: ShipentegraOrderManualPayload = {
    number: clamp(input.orderId, 128),
    packageQuantity: 1,
    description: common.description,
    service: 1,
    currency: common.currency,
    weight: Math.max(common.packageWeight, 0.1),
    width: common.packageWidth,
    height: common.packageHeight,
    length: common.packageLength,
    reference1: clamp(input.labelNumber, 40),
    iossNumber: (input.ioss ?? "").trim() || undefined,
    shippingType: common.shippingType,
    shippingAddress: {
      name: common.receiverAddress.name,
      address: [common.receiverAddress.address1, common.receiverAddress.address2].filter(Boolean).join(" "),
      city: common.receiverAddress.city,
      country: common.receiverAddress.country,
      state: common.receiverAddress.state,
      postalCode: common.receiverAddress.postalCode,
      phone: common.receiverPhone,
      email: clamp((input.userEmail ?? "").trim().toLowerCase(), 60) || undefined,
      town: common.receiverAddress.town,
    },
    items: [
      {
        quantity: 1,
        unitPrice: common.unitPrice,
        name: clamp(common.description, 512),
        sku: common.sku,
        gtip: common.hsCode,
        imageUrl: common.imageUrl,
      },
    ],
  };

  const createErrors: Array<Record<string, unknown>> = [];
  let createdOrderId: number | null = null;
  let createResponsePayload: Record<string, unknown> | null = null;

  try {
    const response = await createShipentegraOrderMulti({
      payload: multiPayload,
      language,
    });
    createResponsePayload = response as unknown as Record<string, unknown>;
    createdOrderId = resolveCreatedOrderId(createResponsePayload);
  } catch (error) {
    if (error instanceof ShipentegraApiError) {
      createErrors.push({
        stage: "create_order_multi",
        message: error.message,
        status: error.status,
        apiCode: error.apiCode,
        details: error.details,
      });
    } else {
      createErrors.push({
        stage: "create_order_multi",
        message: error instanceof Error ? error.message : "Unknown create_order_multi error",
      });
    }
  }

  if (!createdOrderId) {
    try {
      const response = await createShipentegraOrderManual({
        payload: manualPayload,
        language,
      });
      createResponsePayload = response as unknown as Record<string, unknown>;
      createdOrderId = resolveCreatedOrderId(createResponsePayload);
    } catch (error) {
      if (error instanceof ShipentegraApiError) {
        createErrors.push({
          stage: "create_order_manual",
          message: error.message,
          status: error.status,
          apiCode: error.apiCode,
          details: error.details,
        });
      } else {
        createErrors.push({
          stage: "create_order_manual",
          message: error instanceof Error ? error.message : "Unknown create_order_manual error",
        });
      }
    }
  }

  if (!createdOrderId) {
    return {
      status: "failed",
      reason: "ORDER_CREATE_FAILED",
      message: "ShipEntegra order could not be created.",
      response: {
        createErrors,
      },
    };
  }

  try {
    const labelResponse = await createShipentegraLabel({
      payload: {
        orderId: createdOrderId,
        content: common.description,
        weight: Math.max(common.packageWeight, 0.1),
        currency: common.currency,
        iossNumber: (input.ioss ?? "").trim() || undefined,
      },
      language,
    });

    const labelSuccess = labelResponse.success !== false;
    if (!labelSuccess) {
      return {
        status: "failed",
        reason: "LABEL_CREATE_FAILED",
        message: labelResponse.message || "ShipEntegra label could not be created.",
        response: {
          orderId: createdOrderId,
          createResponse: createResponsePayload,
          labelResponse,
        },
      };
    }

    return {
      status: "started",
      orderId: createdOrderId,
      trackingNumber: typeof labelResponse.trackingNumber === "string" ? labelResponse.trackingNumber : null,
      labelUrl: typeof labelResponse.label === "string" ? labelResponse.label : null,
      invoiceUrl: typeof labelResponse.invoice === "string" ? labelResponse.invoice : null,
      response: {
        createResponse: createResponsePayload,
        labelResponse,
      },
      message: labelResponse.message || "ShipEntegra shipment started successfully.",
    };
  } catch (error) {
    if (error instanceof ShipentegraApiError) {
      return {
        status: "failed",
        reason: "LABEL_CREATE_FAILED",
        message: error.message,
        response: {
          orderId: createdOrderId,
          createResponse: createResponsePayload,
          status: error.status,
          apiCode: error.apiCode,
          details: error.details,
        },
      };
    }

    return {
      status: "failed",
      reason: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : "Unexpected ShipEntegra error",
      response: {
        orderId: createdOrderId,
        createResponse: createResponsePayload,
      },
    };
  }
};
