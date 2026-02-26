import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type CreateStoreBody = {
  storeName?: unknown;
  phone?: unknown;
  category?: unknown;
  topCategoryId?: unknown;
  subCategoryId?: unknown;
  currency?: unknown;
  priceCents?: unknown;
  fallbackStoreNamePrefix?: unknown;
};

type StoreCurrency = "USD" | "TRY";

const asTrimmedString = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const asSafePrice = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 2990;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : 2990;
};

const asStoreCurrency = (value: unknown): StoreCurrency => {
  if (typeof value !== "string") {
    return "USD";
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "TRY") {
    return "TRY";
  }

  return "USD";
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes("relation") &&
    (error.message ?? "").toLowerCase().includes("does not exist");
};

const tryProfilePhoneSync = async (userId: string, phone: string) => {
  const nowIso = new Date().toISOString();

  const withTimestamp = await supabaseAdmin
    .from("profiles")
    .update({
      phone,
      updated_at: nowIso,
    })
    .eq("user_id", userId);

  if (!withTimestamp.error) {
    return;
  }

  if (!isMissingColumnError(withTimestamp.error, "updated_at") && !isMissingColumnError(withTimestamp.error, "phone")) {
    return;
  }

  const withoutTimestamp = await supabaseAdmin
    .from("profiles")
    .update({
      phone,
    })
    .eq("user_id", userId);

  if (withoutTimestamp.error) {
    return;
  }
};

const insertStore = async (payload: {
  id: string;
  userId: string;
  storeName: string;
  phone: string;
  category: string;
  topCategoryId: string | null;
  subCategoryId: string | null;
  currency: StoreCurrency;
  priceCents: number;
}) => {
  const requiredInsertPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.userId,
    store_name: payload.storeName,
    status: "pending",
  };

  const optionalInsertPayload: Record<string, unknown> = {
    phone: payload.phone,
    category: payload.category,
    price_cents: payload.priceCents,
    category_id: payload.topCategoryId,
    sub_category_id: payload.subCategoryId,
    subcategory_id: payload.subCategoryId,
    currency: payload.currency.toLowerCase(),
    store_currency: payload.currency,
  };

  const candidatePayload: Record<string, unknown> = {
    ...requiredInsertPayload,
    ...optionalInsertPayload,
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const insertResult = await supabaseAdmin.from("stores").insert(candidatePayload);
    if (!insertResult.error) {
      return null;
    }

    if (isMissingRelationError(insertResult.error)) {
      return "Table public.stores does not exist in remote schema.";
    }

    const removableKey = Object.keys(candidatePayload).find(
      (key) => !Object.prototype.hasOwnProperty.call(requiredInsertPayload, key) && isMissingColumnError(insertResult.error, key)
    );

    if (!removableKey) {
      return insertResult.error.message || "Store creation failed";
    }

    delete candidatePayload[removableKey];
  }

  return "Store creation failed";
};

const countUserStores = async (userId: string) => {
  const { count } = await supabaseAdmin
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return typeof count === "number" ? count : 0;
};

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as CreateStoreBody;

    const phone = asTrimmedString(body.phone);
    if (!phone) {
      return NextResponse.json({ error: "Phone is required." }, { status: 400 });
    }

    const category = asTrimmedString(body.category) || "Genel";
    const topCategoryId = asTrimmedString(body.topCategoryId) || null;
    const subCategoryId = asTrimmedString(body.subCategoryId) || null;
    const currency = asStoreCurrency(body.currency);
    const fallbackPrefix = asTrimmedString(body.fallbackStoreNamePrefix) || "Magazam";
    const requestedStoreName = asTrimmedString(body.storeName);
    const existingCount = requestedStoreName ? 0 : await countUserStores(user.id);
    const storeName = requestedStoreName || `${fallbackPrefix} ${existingCount + 1}`;
    const storeId = randomUUID();
    const priceCents = asSafePrice(body.priceCents);

    await tryProfilePhoneSync(user.id, phone);

    const insertError = await insertStore({
      id: storeId,
      userId: user.id,
      storeName,
      phone,
      category,
      topCategoryId,
      subCategoryId,
      currency,
      priceCents,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError }, { status: 500 });
    }

    return NextResponse.json({ id: storeId, storeName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
