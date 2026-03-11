import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { requeueListingForUser } from "@/lib/extension/listing-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequeueBody = {
  listing_id?: unknown;
  listing_key?: unknown;
  store_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

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

    const body = (await request.json().catch(() => ({}))) as RequeueBody;
    const listingId = toTrimmed(body.listing_id);
    const listingKey = toTrimmed(body.listing_key);
    const storeId = toTrimmed(body.store_id);

    if (!storeId || (!listingId && !listingKey)) {
      return NextResponse.json({ error: "store_id ve listing_id/listing_key zorunludur." }, { status: 400 });
    }
    const requeued = await requeueListingForUser({
      userId: user.id,
      targetClientId: storeId,
      listingId: listingId || null,
      listingKey: listingKey || null,
      reason: "dashboard_products_manual_requeue",
    });

    if (!requeued.reset) {
      return NextResponse.json(
        { error: requeued.reason || "Ürün tekrar sıraya alınamadı." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        row: requeued,
        message: "Ürün tekrar sıraya alındı.",
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ürün tekrar sıraya alınamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
