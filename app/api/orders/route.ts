import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { startNavlungoShipmentForOrder, type NavlungoShipmentDispatchResult } from "@/lib/navlungo/shipment";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueryError = {
  message: string;
  code?: string | null;
};

type OrderRow = {
  id: string;
  user_id?: string | null;
  store_id?: string | null;
  category_name?: string | null;
  sub_product_name?: string | null;
  variant_name?: string | null;
  product_link?: string | null;
  order_date?: string | null;
  shipping_address?: string | null;
  note?: string | null;
  ioss?: string | null;
  label_number?: string | null;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  receiver_country_code?: string | null;
  receiver_state?: string | null;
  receiver_city?: string | null;
  receiver_town?: string | null;
  receiver_postal_code?: string | null;
  amount_usd?: number | string | null;
  payment_status?: string | null;
  navlungo_status?: string | null;
  navlungo_error?: string | null;
  navlungo_store_id?: string | null;
  navlungo_search_id?: string | null;
  navlungo_quote_reference?: string | null;
  navlungo_shipment_id?: string | null;
  navlungo_shipment_reference?: string | null;
  navlungo_tracking_url?: string | null;
  navlungo_response?: Record<string, unknown> | null;
  navlungo_last_synced_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CreateOrderPayload = {
  storeId?: unknown;
  category?: unknown;
  subProductName?: unknown;
  variantName?: unknown;
  productLink?: unknown;
  address?: unknown;
  receiverName?: unknown;
  receiverPhone?: unknown;
  receiverCountryCode?: unknown;
  receiverState?: unknown;
  receiverCity?: unknown;
  receiverTown?: unknown;
  receiverPostalCode?: unknown;
  note?: unknown;
  ioss?: unknown;
  labelNumber?: unknown;
  price?: unknown;
  date?: unknown;
};

type DeleteOrderPayload = {
  id?: unknown;
};

type StoreContextRow = {
  id: string;
  store_name?: string | null;
  name?: string | null;
  phone?: string | null;
  currency?: string | null;
  store_currency?: string | null;
  navlungo_store_id?: string | null;
};

type ProfileContextRow = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

const ORDER_SELECT_CANDIDATES = [
  "id, user_id, store_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, note, ioss, label_number, amount_usd, payment_status, navlungo_status, navlungo_error, navlungo_store_id, navlungo_search_id, navlungo_quote_reference, navlungo_shipment_id, navlungo_shipment_reference, navlungo_tracking_url, navlungo_response, navlungo_last_synced_at, created_at, updated_at",
  "id, user_id, store_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, note, ioss, label_number, amount_usd, payment_status, navlungo_status, navlungo_error, navlungo_store_id, navlungo_search_id, navlungo_quote_reference, navlungo_shipment_id, navlungo_shipment_reference, navlungo_tracking_url, navlungo_last_synced_at, created_at, updated_at",
  "id, user_id, store_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, receiver_name, receiver_phone, receiver_country_code, receiver_state, receiver_city, receiver_town, receiver_postal_code, note, ioss, label_number, amount_usd, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, note, ioss, label_number, amount_usd, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, product_link, order_date, shipping_address, label_number, amount_usd, payment_status, created_at",
] as const;

const ORDER_BY_CANDIDATES = ["created_at", "order_date", "id"] as const;

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const asTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const asIso2CountryCode = (value: unknown) => {
  const candidate = asTrimmedString(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(candidate)) {
    return candidate;
  }
  return "";
};

const asDateString = (value: unknown) => {
  if (typeof value !== "string") {
    return new Date().toISOString().split("T")[0];
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return new Date().toISOString().split("T")[0];
};

const toNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const isMissingTableError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.code === "42P01" || message.includes("could not find the table") || message.includes("relation");
};

const isRecoverableSelectError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select")
  );
};

const isMissingColumnError = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const mapOrderRow = (row: OrderRow) => {
  const amount = toNumber(row.amount_usd);
  const date = row.order_date || row.created_at?.split("T")[0] || new Date().toISOString().split("T")[0];
  const paymentStatus = (row.payment_status || "pending").toLowerCase();

  return {
    id: row.id,
    productName: row.category_name || "",
    subProductName: row.sub_product_name || "",
    variantName: row.variant_name || undefined,
    productLink: row.product_link || "",
    category: row.category_name || "",
    date,
    address: row.shipping_address || "",
    receiverName: row.receiver_name || null,
    receiverPhone: row.receiver_phone || null,
    receiverCountryCode: row.receiver_country_code || null,
    receiverState: row.receiver_state || null,
    receiverCity: row.receiver_city || null,
    receiverTown: row.receiver_town || null,
    receiverPostalCode: row.receiver_postal_code || null,
    isPaid: paymentStatus === "paid",
    note: row.note || undefined,
    ioss: row.ioss || undefined,
    labelNumber: row.label_number || "",
    price: amount,
    storeId: row.store_id || null,
    paymentStatus,
    navlungoStatus: row.navlungo_status || null,
    navlungoError: row.navlungo_error || null,
    navlungoStoreId: row.navlungo_store_id || null,
    navlungoSearchId: row.navlungo_search_id || null,
    navlungoQuoteReference: row.navlungo_quote_reference || null,
    navlungoShipmentId: row.navlungo_shipment_id || null,
    navlungoShipmentReference: row.navlungo_shipment_reference || null,
    navlungoTrackingUrl: row.navlungo_tracking_url || null,
    navlungoLastSyncedAt: row.navlungo_last_synced_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

const selectOrdersWithFallback = async (userId: string) => {
  let lastError: QueryError | null = null;

  outer:
  for (const select of ORDER_SELECT_CANDIDATES) {
    for (const orderBy of ORDER_BY_CANDIDATES) {
      const orderColumn: string = orderBy;
      const queryBase = supabaseAdmin
        .from("orders")
        .select(select as string)
        .eq("user_id", userId)
        .order(orderColumn, { ascending: false });

      const query = orderBy !== "id" ? queryBase.order("id", { ascending: false }) : queryBase;

      const { data, error } = await query;

      if (!error) {
        return ((data ?? []) as unknown as OrderRow[]) ?? [];
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break outer;
      }
    }
  }

  throw new Error(lastError?.message ?? "orders could not be loaded");
};

const loadUserStoreIds = async (userId: string) => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    throw new Error(error.message || "stores could not be loaded");
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  return rows.map((row) => row.id).filter(Boolean);
};

const normalizeCurrencyCode = (value: string | null | undefined) => {
  const candidate = (value ?? "").trim().toUpperCase();
  if (candidate === "TRY") {
    return "TRY";
  }
  return "USD";
};

const loadStoreContext = async (userId: string, storeId: string) => {
  const selectCandidates = [
    "id, store_name, phone, currency, store_currency, navlungo_store_id",
    "id, store_name, phone, currency, store_currency",
    "id, store_name, phone, currency",
    "id, name, phone, currency",
    "id, store_name, phone",
    "id, name, phone",
    "id, store_name",
    "id, name",
    "id",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of selectCandidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(select)
      .eq("id", storeId)
      .eq("user_id", userId)
      .maybeSingle<StoreContextRow>();

    if (!query.error) {
      return query.data ?? null;
    }

    lastError = query.error;
    if (!isRecoverableSelectError(query.error)) {
      break;
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "Store context could not be loaded");
  }

  return null;
};

const loadProfileContext = async (userId: string) => {
  const selectCandidates = ["full_name, email, phone", "full_name, email", "full_name", "email"] as const;
  let lastError: QueryError | null = null;

  for (const select of selectCandidates) {
    const query = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileContextRow>();

    if (!query.error) {
      return query.data ?? null;
    }

    lastError = query.error;
    if (!isRecoverableSelectError(query.error)) {
      break;
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "Profile context could not be loaded");
  }

  return null;
};

const buildNavlungoOrderUpdatePayload = (result: NavlungoShipmentDispatchResult) => {
  const nowIso = new Date().toISOString();

  if (result.status === "started") {
    return {
      navlungo_status: "shipment_started",
      navlungo_error: null,
      navlungo_store_id: result.storeId,
      navlungo_search_id: result.searchId,
      navlungo_quote_reference: result.quoteReference,
      navlungo_shipment_id: result.shipmentId,
      navlungo_shipment_reference: result.shipmentReference,
      navlungo_tracking_url: result.trackingUrl,
      navlungo_response: result.response,
      navlungo_last_synced_at: nowIso,
      updated_at: nowIso,
    } as Record<string, unknown>;
  }

  if (result.status === "failed") {
    return {
      navlungo_status: result.reason === "QUOTE_FAILED" ? "quote_failed" : "shipment_failed",
      navlungo_error: result.message,
      navlungo_response: result.response ?? null,
      navlungo_last_synced_at: nowIso,
      updated_at: nowIso,
    } as Record<string, unknown>;
  }

  return {
    navlungo_status: "skipped",
    navlungo_error: result.message,
    navlungo_response: result.response ?? null,
    navlungo_last_synced_at: nowIso,
    updated_at: nowIso,
  } as Record<string, unknown>;
};

const updateOrderWithColumnFallback = async (args: {
  orderId: string;
  userId: string;
  payload: Record<string, unknown>;
}) => {
  const mutablePayload = { ...args.payload };
  let lastError: QueryError | null = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (Object.keys(mutablePayload).length === 0) {
      return null;
    }

    const update = await supabaseAdmin
      .from("orders")
      .update(mutablePayload)
      .eq("id", args.orderId)
      .eq("user_id", args.userId)
      .select("*")
      .maybeSingle<OrderRow>();

    if (!update.error) {
      return update.data ?? null;
    }

    lastError = update.error;

    const missingColumn = Object.keys(mutablePayload).find((column) => isMissingColumnError(update.error, column));
    if (!missingColumn) {
      throw new Error(update.error.message || "Order Navlungo status could not be updated");
    }

    delete mutablePayload[missingColumn];
  }

  if (lastError) {
    throw new Error(lastError.message || "Order Navlungo status could not be updated");
  }

  return null;
};

const persistStoreNavlungoStoreId = async (args: {
  userId: string;
  storeId: string;
  navlungoStoreId: string;
}) => {
  const normalizedNavlungoStoreId = args.navlungoStoreId.trim();
  if (!normalizedNavlungoStoreId) {
    return;
  }

  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      navlungo_store_id: normalizedNavlungoStoreId,
      updated_at: new Date().toISOString(),
    },
    {
      navlungo_store_id: normalizedNavlungoStoreId,
    },
  ];

  for (const payload of payloadCandidates) {
    const update = await supabaseAdmin
      .from("stores")
      .update(payload)
      .eq("id", args.storeId)
      .eq("user_id", args.userId);

    if (!update.error) {
      return;
    }

    if (!isMissingColumnError(update.error, "navlungo_store_id") && !isMissingColumnError(update.error, "updated_at")) {
      return;
    }
  }
};

export async function GET(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await selectOrdersWithFallback(user.id);
    return NextResponse.json({ rows: rows.map(mapOrderRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orders could not be loaded";

    if (isMissingTableError({ message })) {
      return NextResponse.json({
        rows: [],
        warning: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CreateOrderPayload;

    const category = asTrimmedString(body.category);
    const subProductName = asTrimmedString(body.subProductName);
    const variantName = asTrimmedString(body.variantName) || null;
    const productLink = asTrimmedString(body.productLink);
    const address = asTrimmedString(body.address);
    const receiverName = asTrimmedString(body.receiverName);
    const receiverPhone = asTrimmedString(body.receiverPhone);
    const receiverCountryCode = asIso2CountryCode(body.receiverCountryCode);
    const receiverState = asTrimmedString(body.receiverState) || null;
    const receiverCity = asTrimmedString(body.receiverCity);
    const receiverTown = asTrimmedString(body.receiverTown) || receiverCity;
    const receiverPostalCode = asTrimmedString(body.receiverPostalCode);
    const note = asTrimmedString(body.note) || null;
    const ioss = asTrimmedString(body.ioss) || null;
    const labelNumber = asTrimmedString(body.labelNumber);
    const amountUsd = toNumber(body.price as number | string | null | undefined);
    const date = asDateString(body.date);
    const requestedStoreId = asTrimmedString(body.storeId) || null;
    const userStoreIds = await loadUserStoreIds(user.id);

    let storeId: string | null = null;

    if (requestedStoreId) {
      if (!userStoreIds.includes(requestedStoreId)) {
        return NextResponse.json(
          {
            code: "STORE_NOT_OWNED",
            error: "Selected store does not belong to the current user.",
          },
          { status: 403 }
        );
      }

      storeId = requestedStoreId;
    } else if (userStoreIds.length === 1) {
      storeId = userStoreIds[0];
    } else if (userStoreIds.length > 1) {
      return NextResponse.json(
        {
          code: "STORE_ID_REQUIRED",
          error: "storeId is required when you have more than one store.",
        },
        { status: 400 }
      );
    }

    if (!category || !subProductName || !productLink || !address || !labelNumber) {
      return NextResponse.json({ error: "Missing required order fields." }, { status: 400 });
    }

    if (!receiverName || !receiverPhone || !receiverCountryCode || !receiverCity || !receiverTown || !receiverPostalCode) {
      return NextResponse.json(
        { error: "Missing required receiver fields for Navlungo shipment." },
        { status: 400 }
      );
    }

    if (amountUsd < 0) {
      return NextResponse.json({ error: "Order amount must be zero or positive." }, { status: 400 });
    }

    const payloadCandidates: Array<Record<string, unknown>> = [
      {
        user_id: user.id,
        store_id: storeId,
        category_name: category,
        sub_product_name: subProductName,
        variant_name: variantName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        receiver_country_code: receiverCountryCode,
        receiver_state: receiverState,
        receiver_city: receiverCity,
        receiver_town: receiverTown,
        receiver_postal_code: receiverPostalCode,
        note,
        ioss,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        category_name: category,
        sub_product_name: subProductName,
        variant_name: variantName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        note,
        ioss,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        category_name: category,
        sub_product_name: subProductName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
      },
    ];

    let created: OrderRow | null = null;
    let lastError: QueryError | null = null;

    for (const payload of payloadCandidates) {
      const { data, error } = await supabaseAdmin.from("orders").insert(payload).select("*").maybeSingle<OrderRow>();

      if (!error) {
        created = data ?? null;
        break;
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break;
      }
    }

    if (created) {
      let finalRow: OrderRow = created;
      let navlungo: NavlungoShipmentDispatchResult | null = null;
      let navlungoPersisted = false;

      if (storeId) {
        try {
          const [storeContext, profileContext] = await Promise.all([
            loadStoreContext(user.id, storeId),
            loadProfileContext(user.id),
          ]);

          const navlungoStoreId =
            typeof storeContext?.navlungo_store_id === "string" &&
            storeContext.navlungo_store_id.trim().length > 0
              ? storeContext.navlungo_store_id.trim()
              : null;

          const storeName = storeContext?.store_name ?? storeContext?.name ?? null;
          const storePhone = storeContext?.phone ?? null;
          const storeCurrency = normalizeCurrencyCode(storeContext?.store_currency ?? storeContext?.currency ?? null);

          navlungo = await startNavlungoShipmentForOrder({
            orderId: created.id,
            localStoreId: storeId,
            navlungoStoreId,
            storeName,
            storePhone,
            userEmail: profileContext?.email ?? user.email ?? null,
            userFullName: profileContext?.full_name ?? null,
            userPhone: profileContext?.phone ?? null,
            categoryName: category,
            subProductName,
            variantName,
            shippingAddress: address,
            receiverName,
            receiverPhone,
            receiverCountryCode,
            receiverState,
            receiverCity,
            receiverTown,
            receiverPostalCode,
            labelNumber,
            amountUsd,
            currency: storeCurrency,
          });

          if (navlungo.status === "started") {
            await persistStoreNavlungoStoreId({
              userId: user.id,
              storeId,
              navlungoStoreId: navlungo.storeId,
            });
          }

          const patch = buildNavlungoOrderUpdatePayload(navlungo);
          const updatedRow = await updateOrderWithColumnFallback({
            orderId: created.id,
            userId: user.id,
            payload: patch,
          });

          if (updatedRow) {
            finalRow = updatedRow;
            navlungoPersisted = true;
          }
        } catch (navlungoError) {
          navlungo = {
            status: "failed",
            reason: "UNEXPECTED_ERROR",
            message: navlungoError instanceof Error ? navlungoError.message : "Unexpected Navlungo orchestration error",
          };
        }
      } else {
        navlungo = {
          status: "skipped",
          reason: "MISSING_STORE_ID",
          message: "Store selection is missing; Navlungo shipment was not started.",
        };
      }

      if (navlungo && !navlungoPersisted) {
        try {
          const patch = buildNavlungoOrderUpdatePayload(navlungo);
          const updatedRow = await updateOrderWithColumnFallback({
            orderId: created.id,
            userId: user.id,
            payload: patch,
          });

          if (updatedRow) {
            finalRow = updatedRow;
          }
        } catch {
          // Do not fail order creation response when status persistence columns are unavailable.
        }
      }

      return NextResponse.json({
        row: mapOrderRow(finalRow),
        navlungo,
      });
    }

    if (isMissingTableError(lastError)) {
      return NextResponse.json(
        {
          error: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: lastError?.message ?? "Order could not be created" }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idFromQuery = asTrimmedString(request.nextUrl.searchParams.get("id"));
    let orderId = idFromQuery;

    if (!orderId) {
      const body = (await request.json().catch(() => ({}))) as DeleteOrderPayload;
      orderId = asTrimmedString(body.id);
    }

    if (!orderId) {
      return NextResponse.json({ error: "Order id is required." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .delete()
      .eq("id", orderId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
          },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: error.message || "Order could not be deleted" }, { status: 500 });
    }

    if (!data?.id) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({ id: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be deleted";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
