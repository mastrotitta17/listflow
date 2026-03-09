import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { normalizePublicAssetUrl } from "@/lib/assets/public-url";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  category: string | null;
  store_currency?: string | null;
  currency?: string | null;
};

type ListingRow = {
  id: string;
  key: string | null;
  title: string | null;
  description: string | null;
  image_1_url: string | null;
  price: number | null;
  quantity: number | null;
  status: string | null;
  tags: string[] | null;
  category: string | null;
  created_at: string;
  updated_at: string;
};

const PAGE_SIZE = 18;

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const normalizeStoreCurrency = (value: string | null | undefined): "USD" | "TRY" => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "TRY" || normalized === "TL" || normalized === "₺" || normalized === "TURKISH_LIRA") {
    return "TRY";
  }

  return "USD";
};

const toPositiveInt = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
};

const loadOwnedStores = async (userId: string) => {
  const candidates = [
    "id,user_id,store_name,category,store_currency,currency",
    "id,user_id,store_name,category,store_currency",
    "id,user_id,store_name,category,currency",
    "id,user_id,store_name,category",
  ] as const;

  for (const select of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(select)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!query.error) {
      return ((query.data ?? []) as unknown) as StoreRow[];
    }

    const message = (query.error.message ?? "").toLowerCase();
    if (!message.includes("column")) {
      throw new Error(query.error.message);
    }
  }

  return [] as StoreRow[];
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

    const url = new URL(request.url);
    const requestedStoreId = (url.searchParams.get("storeId") ?? "").trim();
    const queryText = (url.searchParams.get("q") ?? "").trim();
    const page = toPositiveInt(url.searchParams.get("page"), 1);

    const stores = await loadOwnedStores(user.id);
    const normalizedStores = stores.map((store) => ({
      id: store.id,
      name: store.store_name,
      category: store.category,
      currency: normalizeStoreCurrency(store.store_currency ?? store.currency ?? null),
    }));

    const selectedStore =
      normalizedStores.find((store) => store.id === requestedStoreId) ??
      normalizedStores[0] ??
      null;

    if (!selectedStore) {
      return NextResponse.json({
        stores: [],
        selectedStoreId: null,
        rows: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 0,
      });
    }

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let query = supabaseAdmin
      .from("listing")
      .select(
        "id,key,title,description,image_1_url,price,quantity,status,tags,category,created_at,updated_at",
        { count: "exact" }
      )
      .eq("client_id", selectedStore.id)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (queryText) {
      query = query.ilike("title", `%${queryText}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const rows = (((data ?? []) as unknown) as ListingRow[]).map((row) => ({
      id: row.id,
      key: row.key ?? null,
      title: row.title ?? "Untitled",
      description: row.description ?? "",
      imageUrl: normalizePublicAssetUrl(row.image_1_url) ?? null,
      price: Number.isFinite(row.price ?? NaN) ? row.price : 0,
      quantity: row.quantity ?? 0,
      status: row.status ?? "pending",
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [],
      category: row.category ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const total = count ?? rows.length;
    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;

    return NextResponse.json({
      stores: normalizedStores,
      selectedStoreId: selectedStore.id,
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Products could not be loaded.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
