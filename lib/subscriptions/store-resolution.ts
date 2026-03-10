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

  for (const store of stores) {
    const alias = normalizeAlias(store.store_name);
    if (!alias) {
      continue;
    }

    const userId = (store.user_id ?? "").trim();
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
      const explicitStoreId = (subscription.store_id ?? "").trim();
      if (explicitStoreId) {
        return explicitStoreId;
      }

      const shopId = (subscription.shop_id ?? "").trim();
      if (!shopId) {
        return null;
      }

      if (isUuid(shopId)) {
        return shopId;
      }

      const alias = normalizeAlias(shopId);
      if (!alias) {
        return null;
      }

      const userId = (subscription.user_id ?? "").trim();
      if (userId) {
        const scopedMatch = scoped.get(`${userId}:${alias}`) ?? null;
        if (scopedMatch) {
          return scopedMatch;
        }
      }

      if ((globalCounts.get(alias) ?? 0) === 1) {
        return globalStoreIds.get(alias) ?? null;
      }

      return null;
    },
  };
};
