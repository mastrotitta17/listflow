import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionUser } from "@/lib/extension/api-auth";
import { claimNextListingForUser } from "@/lib/extension/listing-queue";
import { isSubscriptionActive, loadUserSubscriptions } from "@/lib/settings/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimBody = {
  client_id?: unknown;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscriptions = await loadUserSubscriptions(auth.user.id);
    const hasActiveSubscription = subscriptions.some((row) => isSubscriptionActive(row));
    if (!hasActiveSubscription) {
      return NextResponse.json(
        { error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as ClaimBody;
    const preferredClientId = toTrimmed(body.client_id);

    const nextListing = await claimNextListingForUser({
      userId: auth.user.id,
      preferredClientId: preferredClientId || null,
    });

    if (!nextListing) {
      return NextResponse.json(
        {
          ok: true,
          job: null,
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
