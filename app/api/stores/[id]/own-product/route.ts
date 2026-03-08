import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const OWN_PRODUCT_WEBHOOK_URL =
  process.env.OWN_PRODUCT_N8N_WEBHOOK_URL?.trim() ||
  "https://n8n.srv1162127.hstgr.cloud/webhook/ec50ca6c-0e9d-4fa5-aac6-d2fe69b11ce4";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type OwnedStoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  category: string | null;
  store_currency?: string | null;
  currency?: string | null;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const asTrimmedString = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

const normalizeStoreCurrency = (value: string | null | undefined): "USD" | "TRY" => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "TRY" || normalized === "TL" || normalized === "₺" || normalized === "TURKISH_LIRA") {
    return "TRY";
  }

  return "USD";
};

const loadOwnedStore = async (userId: string, storeId: string) => {
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
      .eq("id", storeId)
      .eq("user_id", userId)
      .maybeSingle<OwnedStoreRow>();

    if (!query.error) {
      return query.data ?? null;
    }

    const message = (query.error.message ?? "").toLowerCase();
    if (!message.includes("column")) {
      throw new Error(query.error.message);
    }
  }

  return null;
};

const parsePrice = (value: string) => {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: storeId } = await params;
    const store = await loadOwnedStore(user.id, storeId);

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const title = asTrimmedString(formData.get("title")).slice(0, 180);
    const description = asTrimmedString(formData.get("description")).slice(0, 5000);
    const price = parsePrice(asTrimmedString(formData.get("price")));
    const image = formData.get("image");

    if (!title) {
      return NextResponse.json({ error: "Ürün başlığı zorunludur." }, { status: 400 });
    }

    if (!description) {
      return NextResponse.json({ error: "Ürün açıklaması zorunludur." }, { status: 400 });
    }

    if (price === null) {
      return NextResponse.json({ error: "Geçerli bir fiyat girin." }, { status: 400 });
    }

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Ürün görseli zorunludur." }, { status: 400 });
    }

    if (!image.type.startsWith("image/")) {
      return NextResponse.json({ error: "Yalnızca görsel yükleyebilirsiniz." }, { status: 400 });
    }

    if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Görsel boyutu 10 MB altında olmalıdır." }, { status: 400 });
    }

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const imageBase64 = imageBuffer.toString("base64");
    const storeCurrency = normalizeStoreCurrency(store.store_currency ?? store.currency ?? null);

    const webhookPayload = {
      source: "listflow_dashboard_own_product",
      category: "ownProduct",
      storeId: store.id,
      store_id: store.id,
      clientId: store.id,
      client_id: store.id,
      storeName: store.store_name,
      store_name: store.store_name,
      storeCurrency,
      store_currency: storeCurrency,
      storeCategory: store.category ?? null,
      store_category: store.category ?? null,
      title,
      productTitle: title,
      product_title: title,
      description,
      productDescription: description,
      product_description: description,
      price,
      productPrice: price,
      product_price: price,
      imageBase64,
      image_base64: imageBase64,
      image_1_base64: imageBase64,
      imageMimeType: image.type || null,
      image_mime_type: image.type || null,
      imageFileName: image.name || null,
      image_file_name: image.name || null,
      submittedAt: new Date().toISOString(),
    };

    const upstreamResponse = await fetch(OWN_PRODUCT_WEBHOOK_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookPayload),
      signal: AbortSignal.timeout(45_000),
    });

    const responseText = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        {
          error: responseText || "Ürün işleme isteği gönderilemedi.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Ürün işleme isteği gönderildi.",
      upstreamResponse: responseText || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ürün isteği gönderilemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
