import { isUuid } from "@/lib/utils/uuid";

export type SubscriptionStoreReference = {
  user_id?: string | null;
  store_id?: string | null;
  shop_id?: string | null;
};

export type StoreAliasReference = {
  id: string;
  user_id?: string | null;
  store_name?: string | null;
};

const normalizeAlias = (value: string | null | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
};

export const buildStoreAliasIndex = (stores: StoreAliasReference[]) => {
  const scoped = new Map<string, string>();
  const globalCounts = new Map<string, number>();
  const globalStoreIds = new Map<string, string>();
  const knownStoreIds = new Set<string>();
  const storeUserById = new Map<string, string>();

  for (const store of stores) {
    knownStoreIds.add(store.id);
    const normalizedUserId = (store.user_id ?? "").trim();
    if (normalizedUserId) {
      storeUserById.set(store.id, normalizedUserId);
    }

    const alias = normalizeAlias(store.store_name);
    if (!alias) {
      continue;
    }

    const userId = normalizedUserId;
    if (userId) {
      scoped.set(`${userId}:${alias}`, store.id);
    }

    globalCounts.set(alias, (globalCounts.get(alias) ?? 0) + 1);
    if (!globalStoreIds.has(alias)) {
      globalStoreIds.set(alias, store.id);
    }
  }

  return {
    resolve(subscription: SubscriptionStoreReference) {
      const userId = (subscription.user_id ?? "").trim();
      const explicitStoreId = (subscription.store_id ?? "").trim();
      let explicitFallback: string | null = null;
      if (explicitStoreId && knownStoreIds.has(explicitStoreId)) {
        const storeOwner = storeUserById.get(explicitStoreId) ?? "";
        if (!userId || !storeOwner || storeOwner === userId) {
          return explicitStoreId;
        }
      } else if (explicitStoreId) {
        explicitFallback = explicitStoreId;
      }

      const shopId = (subscription.shop_id ?? "").trim();
      if (!shopId) {
        return explicitFallback;
      }

      if (isUuid(shopId)) {
        if (knownStoreIds.has(shopId)) {
          const storeOwner = storeUserById.get(shopId) ?? "";
          if (!userId || !storeOwner || storeOwner === userId) {
            return shopId;
          }
        }
        return explicitFallback;
      }

      const alias = normalizeAlias(shopId);
      if (!alias) {
        return explicitFallback;
      }

      if (userId) {
        const scopedMatch = scoped.get(`${userId}:${alias}`) ?? null;
        if (scopedMatch) {
          return scopedMatch;
        }
      }

      if ((globalCounts.get(alias) ?? 0) === 1) {
        return globalStoreIds.get(alias) ?? null;
      }

      return explicitFallback;
    },
  };
};
