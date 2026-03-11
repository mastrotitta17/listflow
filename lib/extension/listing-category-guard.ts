import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildStrictListingCategoryNeedles,
  listingCategoryMatchesStoreProfile,
} from "@/lib/stores/product-resolution";

type StoreCategoryContext = {
  id: string;
  storeName: string | null;
  category: string | null;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const STORE_SELECT_CANDIDATES = [
  "id,store_name,category",
  "id,store_name",
] as const;

export const loadStoreCategoryContextByClientId = async (clientId: string): Promise<StoreCategoryContext | null> => {
  const normalizedClientId = toTrimmed(clientId);
  if (!normalizedClientId) {
    return null;
  }

  for (const select of STORE_SELECT_CANDIDATES) {
    const query = await supabaseAdmin
      .from("stores")
      .select(select)
      .eq("id", normalizedClientId)
      .maybeSingle<{ id: string; store_name?: string | null; category?: string | null }>();

    if (!query.error) {
      if (!query.data) {
        return null;
      }

      return {
        id: normalizedClientId,
        storeName: toTrimmed(query.data.store_name) || null,
        category: toTrimmed(query.data.category) || null,
      };
    }

    const message = (query.error.message ?? "").toLowerCase();
    if (!message.includes("column")) {
      throw new Error(query.error.message);
    }
  }

  return null;
};

export const isStoreCategoryMismatch = (args: {
  storeCategory?: string | null;
  listingCategory?: string | null;
}) => {
  const storeCategory = toTrimmed(args.storeCategory);
  const listingCategory = toTrimmed(args.listingCategory);

  if (!storeCategory || !listingCategory) {
    return false;
  }

  return !listingCategoryMatchesStoreProfile(
    listingCategory,
    buildStrictListingCategoryNeedles({
      storeCategory,
      product: null,
    })
  );
};

export const applyMismatchManualReviewToPayload = <
  T extends Record<string, unknown>,
>(payload: T, args: { storeCategory?: string | null; listingCategory?: string | null }) => {
  if (!isStoreCategoryMismatch(args)) {
    return {
      payload,
      mismatch: false,
      reason: null as string | null,
    };
  }

  const nextPayload = { ...payload } as Record<string, unknown>;
  const reason = "store_category_mismatch";

  if (Object.prototype.hasOwnProperty.call(nextPayload, "status")) {
    nextPayload.status = "manual_review";
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "listing_status")) {
    nextPayload.listing_status = "manual_review";
  }

  if (Object.prototype.hasOwnProperty.call(nextPayload, "claimed_at")) {
    nextPayload.claimed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "claimed_by_user_id")) {
    nextPayload.claimed_by_user_id = null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "claimed_by")) {
    nextPayload.claimed_by = null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "processed_at")) {
    nextPayload.processed_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "error")) {
    nextPayload.error = reason;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "last_error")) {
    nextPayload.last_error = reason;
  }

  return {
    payload: nextPayload as T,
    mismatch: true,
    reason,
  };
};
