import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { loadUserStoreQuota } from "@/lib/stores/quota";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type CreateStoreBody = {
  storeName?: unknown;
  phone?: unknown;
  category?: unknown;
  priceCents?: unknown;
  fallbackStoreNamePrefix?: unknown;
};

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
  priceCents: number;
}) => {
  const fullInsert = await supabaseAdmin.from("stores").insert({
    id: payload.id,
    user_id: payload.userId,
    store_name: payload.storeName,
    phone: payload.phone,
    category: payload.category,
    status: "pending",
    price_cents: payload.priceCents,
  });

  if (!fullInsert.error) {
    return null;
  }

  if (isMissingRelationError(fullInsert.error)) {
    return "Table public.stores does not exist in remote schema.";
  }

  const reducedPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.userId,
    store_name: payload.storeName,
    status: "pending",
  };

  if (!isMissingColumnError(fullInsert.error, "phone")) {
    reducedPayload.phone = payload.phone;
  }
  if (!isMissingColumnError(fullInsert.error, "category")) {
    reducedPayload.category = payload.category;
  }
  if (!isMissingColumnError(fullInsert.error, "price_cents")) {
    reducedPayload.price_cents = payload.priceCents;
  }

  const reducedInsert = await supabaseAdmin.from("stores").insert(reducedPayload);
  if (!reducedInsert.error) {
    return null;
  }

  return reducedInsert.error.message || fullInsert.error.message || "Store creation failed";
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
    const fallbackPrefix = asTrimmedString(body.fallbackStoreNamePrefix) || "Magazam";
    const requestedStoreName = asTrimmedString(body.storeName);
    const quota = await loadUserStoreQuota(user.id);

    if (!quota.canCreateStore) {
      return NextResponse.json(
        {
          code: "STORE_LIMIT_REACHED",
          error:
            quota.plan === "turbo"
              ? "Mağaza limitiniz doldu. Yeni mağaza için +$10 ek mağaza paketi satın alabilir veya mevcut mağazalarınızı düzenleyebilirsiniz."
              : "Mağaza limitiniz doldu. Yeni mağaza için +$20 ek mağaza paketi satın alabilir veya planınızı yükseltebilirsiniz.",
          quota,
        },
        { status: 409 }
      );
    }

    const existingCount = requestedStoreName ? 0 : quota.totalStores;
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
