import { supabaseAdmin } from "@/lib/supabase/admin";

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
  void args;
  return false;
};

export const applyMismatchManualReviewToPayload = <
  T extends Record<string, unknown>,
>(payload: T, args: { storeCategory?: string | null; listingCategory?: string | null }) => {
  void args;
  return {
    payload,
    mismatch: false,
    reason: null as string | null,
  };
};
