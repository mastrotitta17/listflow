import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startShipentegraShipmentForOrder, type ShipentegraShipmentDispatchResult } from "@/lib/shipentegra/shipment";
import { isUuid } from "@/lib/utils/uuid";

type QueryError = {
  message?: string;
  code?: string | null;
};

type OrderShipmentRow = {
  id: string;
  user_id?: string | null;
  store_id?: string | null;
  category_name?: string | null;
  sub_product_name?: string | null;
  variant_name?: string | null;
  shipping_address?: string | null;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  receiver_country_code?: string | null;
  receiver_state?: string | null;
  receiver_city?: string | null;
  receiver_town?: string | null;
  receiver_postal_code?: string | null;
  label_number?: string | null;
  amount_usd?: number | string | null;
  ioss?: string | null;
  payment_status?: string | null;
  shipment_status?: string | null;
  shipment_external_order_id?: string | null;
  navlungo_status?: string | null;
  navlungo_search_id?: string | null;
  navlungo_shipment_id?: string | null;
};

type StoreContextRow = {
  id: string;
  store_name?: string | null;
  name?: string | null;
  phone?: string | null;
  currency?: string | null;
  store_currency?: string | null;
};

type ProfileContextRow = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type CheckoutPaymentState = "paid" | "pending" | "failed";

export type CheckoutPaymentSyncResult = {
  paymentId: string | null;
  paymentStatus: CheckoutPaymentState;
  orderId: string | null;
  orderUpdated: boolean;
};

const isMissingColumnError = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isRecoverableColumnError = (error: QueryError | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const isRecoverableSelectError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select")
  );
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

const normalizeCheckoutPaymentStatus = (
  status: string | null | undefined,
  forcedStatus?: CheckoutPaymentState
): CheckoutPaymentState => {
  if (forcedStatus) {
    return forcedStatus;
  }

  const normalized = (status ?? "").toLowerCase();

  if (normalized === "paid" || normalized === "no_payment_required") {
    return "paid";
  }

  if (normalized === "failed") {
    return "failed";
  }

  return "pending";
};

const parseOrderIdFromMetadata = (session: Stripe.Checkout.Session) => {
  const metadataOrderId = session.metadata?.orderId;
  if (metadataOrderId && isUuid(metadataOrderId)) {
    return metadataOrderId;
  }

  const metadataShopId = session.metadata?.shopId;
  if (metadataShopId && metadataShopId.startsWith("order_")) {
    const parsedOrderId = metadataShopId.slice("order_".length);
    if (isUuid(parsedOrderId)) {
      return parsedOrderId;
    }
  }

  return null;
};

const findExistingPaymentBySessionId = async (sessionId: string) => {
  const withSessionId = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!withSessionId.error) {
    return {
      id: withSessionId.data?.id ?? null,
      hasStripeSessionColumn: true,
    };
  }

  if (!isMissingColumnError(withSessionId.error, "stripe_session_id")) {
    throw new Error(withSessionId.error.message ?? "Could not query payments by stripe_session_id");
  }

  return {
    id: null,
    hasStripeSessionColumn: false,
  };
};

const findExistingPaymentByShopFallback = async (shopId: string | null) => {
  if (!shopId) {
    return null;
  }

  const withShopId = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!withShopId.error) {
    return withShopId.data?.id ?? null;
  }

  if (isMissingColumnError(withShopId.error, "shop_id")) {
    return null;
  }

  throw new Error(withShopId.error.message ?? "Could not query payments by shop_id");
};

const updateExistingPayment = async (args: {
  paymentId: string;
  userId: string | null;
  shopId: string | null;
  sessionId: string;
  amountCents: number;
  currency: string;
  status: CheckoutPaymentState;
}) => {
  const updateCandidates: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      shop_id: args.shopId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      shop_id: args.shopId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const patch of updateCandidates) {
    const updated = await supabaseAdmin.from("payments").update(patch).eq("id", args.paymentId);

    if (!updated.error) {
      return;
    }

    lastError = updated.error;

    if (!isRecoverableColumnError(updated.error, ["user_id", "shop_id", "stripe_session_id", "amount_cents", "currency", "status"])) {
      throw new Error(updated.error.message ?? "Could not update payment");
    }
  }

  throw new Error(lastError?.message ?? "Could not update payment");
};

const insertPayment = async (args: {
  userId: string | null;
  shopId: string | null;
  sessionId: string;
  amountCents: number;
  currency: string;
  status: CheckoutPaymentState;
}) => {
  const insertCandidates: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      shop_id: args.shopId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      shop_id: args.shopId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const payload of insertCandidates) {
    const inserted = await supabaseAdmin
      .from("payments")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!inserted.error) {
      return inserted.data?.id ?? null;
    }

    lastError = inserted.error;

    if (!isRecoverableColumnError(inserted.error, ["user_id", "shop_id", "stripe_session_id", "amount_cents", "currency", "status"])) {
      throw new Error(inserted.error.message ?? "Could not insert payment");
    }
  }

  throw new Error(lastError?.message ?? "Could not insert payment");
};

const updateOrderPaymentStatus = async (args: {
  orderId: string;
  userId: string | null;
  status: CheckoutPaymentState;
}) => {
  const updateCandidates: Array<Record<string, unknown>> = [
    {
      payment_status: args.status,
      updated_at: new Date().toISOString(),
    },
    {
      payment_status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const patch of updateCandidates) {
    let query = supabaseAdmin.from("orders").update(patch).eq("id", args.orderId);

    if (args.userId && isUuid(args.userId)) {
      query = query.eq("user_id", args.userId);
    }

    const updated = await query.select("id").limit(1).maybeSingle<{ id: string }>();

    if (!updated.error) {
      return Boolean(updated.data?.id);
    }

    lastError = updated.error;

    if (!isRecoverableColumnError(updated.error, ["payment_status", "updated_at", "user_id"])) {
      throw new Error(updated.error.message ?? "Could not update order payment status");
    }
  }

  throw new Error(lastError?.message ?? "Could not update order payment status");
};

const loadOrderForShipment = async (args: { orderId: string; userId: string | null }) => {
  const selectCandidates = [
    "id, user_id, store_id, category_name, sub_product_name, variant_name, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, label_number, amount_usd, ioss, payment_status, shipment_status, shipment_external_order_id, navlungo_status, navlungo_search_id, navlungo_shipment_id",
    "id, user_id, store_id, category_name, sub_product_name, variant_name, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, label_number, amount_usd, ioss, payment_status, navlungo_status, navlungo_search_id, navlungo_shipment_id",
    "id, user_id, store_id, category_name, sub_product_name, variant_name, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, label_number, amount_usd, ioss, payment_status",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of selectCandidates) {
    let query = supabaseAdmin.from("orders").select(select).eq("id", args.orderId);
    if (args.userId && isUuid(args.userId)) {
      query = query.eq("user_id", args.userId);
    }

    const result = await query.maybeSingle<OrderShipmentRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    lastError = result.error;
    if (!isRecoverableSelectError(result.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Could not load order for shipment");
};

const loadStoreContext = async (args: { userId: string | null; storeId: string }) => {
  const selectCandidates = [
    "id, store_name, phone, currency, store_currency",
    "id, name, phone, currency",
    "id, store_name, phone",
    "id, name, phone",
    "id, store_name",
    "id, name",
    "id",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of selectCandidates) {
    let query = supabaseAdmin.from("stores").select(select).eq("id", args.storeId);
    if (args.userId && isUuid(args.userId)) {
      query = query.eq("user_id", args.userId);
    }

    const result = await query.maybeSingle<StoreContextRow>();
    if (!result.error) {
      return result.data ?? null;
    }

    lastError = result.error;
    if (!isRecoverableSelectError(result.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Could not load store context for shipment");
};

const loadProfileContext = async (userId: string | null) => {
  if (!userId || !isUuid(userId)) {
    return null;
  }

  const selectCandidates = ["full_name, email, phone", "full_name, email", "full_name", "email"] as const;
  let lastError: QueryError | null = null;

  for (const select of selectCandidates) {
    const result = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileContextRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    lastError = result.error;
    if (!isRecoverableSelectError(result.error)) {
      break;
    }
  }

  if (lastError) {
    throw new Error(lastError.message ?? "Could not load profile context for shipment");
  }

  return null;
};

const isShipmentAlreadyStarted = (row: OrderShipmentRow) => {
  const status = (row.shipment_status ?? row.navlungo_status ?? "").toLowerCase();
  if (status === "shipment_started") {
    return true;
  }

  return Boolean(row.shipment_external_order_id || row.navlungo_search_id || row.navlungo_shipment_id);
};

const buildShipmentPatch = (result: ShipentegraShipmentDispatchResult) => {
  const nowIso = new Date().toISOString();

  if (result.status === "started") {
    return {
      shipment_status: "shipment_started",
      shipment_error: null,
      shipment_provider: "shipentegra",
      shipment_external_order_id: String(result.orderId),
      shipment_tracking_number: result.trackingNumber,
      shipment_label_url: result.labelUrl ?? null,
      shipment_invoice_url: result.invoiceUrl ?? null,
      shipment_response: result.response ?? null,
      shipment_last_synced_at: nowIso,
      navlungo_status: "shipment_started",
      navlungo_error: null,
      navlungo_search_id: String(result.orderId),
      navlungo_shipment_id: String(result.orderId),
      navlungo_shipment_reference: result.trackingNumber,
      navlungo_tracking_url: result.labelUrl ?? result.invoiceUrl ?? null,
      navlungo_response: result.response ?? null,
      navlungo_last_synced_at: nowIso,
      updated_at: nowIso,
    } as Record<string, unknown>;
  }

  const failedStatus =
    result.status === "failed"
      ? result.reason === "ORDER_CREATE_FAILED"
        ? "order_create_failed"
        : "shipment_failed"
      : "skipped";

  return {
    shipment_status: failedStatus,
    shipment_error: result.message,
    shipment_provider: "shipentegra",
    shipment_response: result.response ?? null,
    shipment_last_synced_at: nowIso,
    navlungo_status: failedStatus,
    navlungo_error: result.message,
    navlungo_response: result.response ?? null,
    navlungo_last_synced_at: nowIso,
    updated_at: nowIso,
  } as Record<string, unknown>;
};

const updateOrderShipmentWithFallback = async (args: {
  orderId: string;
  userId: string | null;
  patch: Record<string, unknown>;
}) => {
  const mutablePatch = { ...args.patch };
  let lastError: QueryError | null = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (Object.keys(mutablePatch).length === 0) {
      return;
    }

    let query = supabaseAdmin.from("orders").update(mutablePatch).eq("id", args.orderId);
    if (args.userId && isUuid(args.userId)) {
      query = query.eq("user_id", args.userId);
    }

    const updated = await query.select("id").limit(1).maybeSingle<{ id: string }>();
    if (!updated.error) {
      return;
    }

    lastError = updated.error;

    const missingColumn = Object.keys(mutablePatch).find((column) => isMissingColumnError(updated.error, column));
    if (!missingColumn) {
      throw new Error(updated.error.message ?? "Could not update order shipment status");
    }

    delete mutablePatch[missingColumn];
  }

  if (lastError) {
    throw new Error(lastError.message ?? "Could not update order shipment status");
  }
};

const startShipmentForPaidOrder = async (args: { orderId: string; userId: string | null }) => {
  const order = await loadOrderForShipment(args);
  if (!order) {
    return;
  }

  if ((order.payment_status ?? "").toLowerCase() !== "paid") {
    return;
  }

  if (!order.store_id || isShipmentAlreadyStarted(order)) {
    return;
  }

  const [storeContext, profileContext] = await Promise.all([
    loadStoreContext({ userId: args.userId ?? order.user_id ?? null, storeId: order.store_id }),
    loadProfileContext(args.userId ?? order.user_id ?? null),
  ]);

  const storeName = storeContext?.store_name ?? storeContext?.name ?? null;
  const storePhone = storeContext?.phone ?? null;
  const storeCurrency = normalizeCurrencyCode(storeContext?.store_currency ?? storeContext?.currency ?? null);

  let shipment: ShipentegraShipmentDispatchResult;
  try {
    shipment = await startShipentegraShipmentForOrder({
      orderId: order.id,
      localStoreId: order.store_id,
      storeName,
      storePhone,
      userEmail: profileContext?.email ?? null,
      userFullName: profileContext?.full_name ?? null,
      userPhone: profileContext?.phone ?? null,
      categoryName: order.category_name ?? "",
      subProductName: order.sub_product_name ?? "",
      variantName: order.variant_name ?? null,
      shippingAddress: order.shipping_address ?? "",
      receiverName: order.receiver_name ?? null,
      receiverPhone: order.receiver_phone ?? null,
      receiverCountryCode: order.receiver_country_code ?? null,
      receiverState: order.receiver_state ?? null,
      receiverCity: order.receiver_city ?? null,
      receiverTown: order.receiver_town ?? null,
      receiverPostalCode: order.receiver_postal_code ?? null,
      labelNumber: order.label_number ?? "",
      amountUsd: Number(order.amount_usd ?? 0),
      currency: storeCurrency,
      ioss: order.ioss ?? null,
    });
  } catch (error) {
    shipment = {
      status: "failed",
      reason: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : "Unexpected ShipEntegra orchestration error",
    };
  }

  await updateOrderShipmentWithFallback({
    orderId: order.id,
    userId: args.userId ?? order.user_id ?? null,
    patch: buildShipmentPatch(shipment),
  });
};

export const syncOneTimeCheckoutPayment = async (
  session: Stripe.Checkout.Session,
  options?: { forcedStatus?: CheckoutPaymentState }
): Promise<CheckoutPaymentSyncResult> => {
  const paymentStatus = normalizeCheckoutPaymentStatus(session.payment_status, options?.forcedStatus);
  const userId = session.metadata?.userId ?? null;
  const shopId = session.metadata?.shopId ?? null;
  const orderId = parseOrderIdFromMetadata(session);
  const amountCents = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toLowerCase();

  const existing = await findExistingPaymentBySessionId(session.id);

  let paymentId = existing.id;

  if (!paymentId && !existing.hasStripeSessionColumn) {
    paymentId = await findExistingPaymentByShopFallback(shopId);
  }

  if (paymentId) {
    await updateExistingPayment({
      paymentId,
      userId,
      shopId,
      sessionId: session.id,
      amountCents,
      currency,
      status: paymentStatus,
    });
  } else {
    paymentId = await insertPayment({
      userId,
      shopId,
      sessionId: session.id,
      amountCents,
      currency,
      status: paymentStatus,
    });
  }

  let orderUpdated = false;

  if (orderId) {
    orderUpdated = await updateOrderPaymentStatus({
      orderId,
      userId,
      status: paymentStatus,
    });

    if (paymentStatus === "paid") {
      await startShipmentForPaidOrder({ orderId, userId });
    }
  }

  return {
    paymentId,
    paymentStatus,
    orderId,
    orderUpdated,
  };
};
