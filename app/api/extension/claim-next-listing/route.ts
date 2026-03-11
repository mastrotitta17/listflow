import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { claimNextListingForUser } from "@/lib/extension/listing-queue";
import {
  buildSubscriptionStoreIdResolver,
  filterSubscriptionsForStore,
  loadUserSubscriptions,
  summarizeStoreSubscriptions,
} from "@/lib/settings/subscriptions";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimBody = {
  client_id?: unknown;
  force_recover?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscriptions = await loadUserSubscriptions(auth.user.id);
    const { data: storesData, error: storesError } = await supabaseAdmin
      .from("stores")
      .select("id, user_id, store_name")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });

    if (storesError) {
      throw new Error(storesError.message);
    }

    const stores = (storesData ?? []) as Array<{ id: string; user_id: string | null; store_name: string | null }>;
    const resolveStoreId = buildSubscriptionStoreIdResolver(
      stores.map((store) => ({
        id: store.id,
        user_id: store.user_id ?? auth.user.id,
        store_name: store.store_name ?? null,
      }))
    );
    const summaries = stores.map((store) => {
      const summary = summarizeStoreSubscriptions(
        filterSubscriptionsForStore(subscriptions, store.id, { resolveStoreId })
      );
      return {
        storeId: store.id,
        storeName: store.store_name ?? store.id,
        ...summary,
      };
    });
    const hasActiveSubscription = summaries.some((row) => row.renewalState === "active");
    if (!hasActiveSubscription) {
      const body = (await request.json().catch(() => ({}))) as ClaimBody;
      const preferredClientId = toTrimmed(body.client_id);
      const preferredSummary =
        summaries.find((row) => row.storeId === preferredClientId) ??
        summaries.find((row) => row.renewalState === "renewal_required") ??
        null;

      if (preferredSummary?.renewalState === "renewal_required") {
        return NextResponse.json(
          {
            error: "Store subscription renewal required",
            code: "SUBSCRIPTION_RENEWAL_REQUIRED",
            storeId: preferredSummary.storeId,
            storeName: preferredSummary.storeName,
            renewalState: preferredSummary.renewalState,
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as ClaimBody;
    const preferredClientId = toTrimmed(body.client_id);
    const forceRecover = Boolean(body.force_recover);

    if (preferredClientId) {
      const preferredSummary = summaries.find((row) => row.storeId === preferredClientId) ?? null;
      if (preferredSummary && preferredSummary.renewalState === "renewal_required") {
        return NextResponse.json(
          {
            error: "Store subscription renewal required",
            code: "SUBSCRIPTION_RENEWAL_REQUIRED",
            storeId: preferredSummary.storeId,
            storeName: preferredSummary.storeName,
            renewalState: preferredSummary.renewalState,
          },
          { status: 403 }
        );
      }
    }

    const nextListing = await claimNextListingForUser({
      userId: auth.user.id,
      preferredClientId: preferredClientId || null,
      forceRecover,
    });

    if (!nextListing.ok) {
      return NextResponse.json(
        {
          ok: true,
          job: null,
          code: nextListing.reason,
          mismatched_count: nextListing.mismatchedCount,
          candidate_count: nextListing.candidateCount,
          message:
            "Yüklenecek ürün bulunamadı. listing.client_id seçili mağazayla eşleşmiyor veya ürün durumu yükleme için uygun değil.",
          preferred_client_id: preferredClientId || null,
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        job: {
          type: "LISTING_CREATE",
          listing_id: nextListing.listingPayload.listing_id ?? null,
          listing_key: nextListing.listingPayload.listing_key ?? null,
          client_id: nextListing.listingPayload.client_id ?? null,
          listing_payload: nextListing.listingPayload,
        },
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim listing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
