"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../store";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../../lib/supabaseClient";
import {
  Store,
  Plus,
  Info,
  MessageCircle,
  Smartphone,
  Loader2,
  Package,
  Cog,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import type { Shop } from "@/types";

type BillingPlan = "standard" | "pro" | "turbo";

type StoreOverviewRow = {
  id: string;
  storeName: string;
  category: string | null;
  status: string | null;
  priceCents: number;
  orderCount: number;
  hasActiveSubscription: boolean;
  hasActiveAutomationWebhook?: boolean;
  plan: string | null;
  subscriptionStatus: string | null;
  automationIntervalHours: number | null;
  automationLastRunAt: string | null;
  lastSuccessfulAutomationAt?: string | null;
  nextAutomationAt: string | null;
  automationState?: "waiting" | "due" | "processing" | "retrying" | "error";
  canDelete: boolean;
  deleteBlockedReason: "active_subscription" | "automation_running" | null;
};

type StoreOverviewResponse = {
  rows?: StoreOverviewRow[];
  error?: string;
};

type StoreUpgradeOption = {
  plan: BillingPlan;
  includedStores: number;
  monthlyPriceCents: number;
};

type StoreQuotaPayload = {
  plan: BillingPlan;
  hasActiveSubscription: boolean;
  includedStoreLimit: number;
  totalStores: number;
  purchasedExtraStores: number;
  usedExtraStores: number;
  remainingSlots: number;
  canCreateStore: boolean;
  extraStorePriceCents: number;
  upgradeOptions: StoreUpgradeOption[];
};

type StoreActionMessage = {
  type: "success" | "error";
  text: string;
};

const DEFAULT_CRISP_WEBSITE_ID = "90902ea5-80af-4468-8f9d-d9a808ed1137";

const EtsyPanel: React.FC = () => {
  const { shops, setShops } = useStore();
  const { t, locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);
  const [showConnect, setShowConnect] = useState(false);
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [storeActionMessage, setStoreActionMessage] = useState<StoreActionMessage | null>(null);
  const [hoveredTimerStoreId, setHoveredTimerStoreId] = useState<string | null>(null);
  const [pinnedTimerStoreId, setPinnedTimerStoreId] = useState<string | null>(null);
  const [deleteTargetShop, setDeleteTargetShop] = useState<Shop | null>(null);
  const [isDeletingStoreId, setIsDeletingStoreId] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [storeQuota, setStoreQuota] = useState<StoreQuotaPayload | null>(null);
  const [isOpeningUpgradePortal, setIsOpeningUpgradePortal] = useState(false);
  const [isBuyingExtraStoreSlot, setIsBuyingExtraStoreSlot] = useState(false);
  const isStoreCreationLocked = Boolean(storeQuota && !storeQuota.canCreateStore);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedCat && categories[0]) {
      setSelectedCat(categories[0].id);
    }
  }, [categories, selectedCat]);

  const moneyLabel = (priceCents: number) => {
    return `$${(priceCents / 100).toFixed(2)}`;
  };

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
        style: "currency",
        currency: "USD",
      }),
    [locale]
  );

  const planLabel = (plan: string | null | undefined) => {
    const normalized = (plan ?? "").toLowerCase();

    if (normalized === "standard") return t("dashboard.planStandard");
    if (normalized === "pro") return t("dashboard.planPro");
    if (normalized === "turbo") return t("dashboard.planTurbo");

    return t("dashboard.planUnknown");
  };

  const mapOverviewRowToShop = useCallback(
    (row: StoreOverviewRow): Shop => ({
      id: row.id,
      name: row.storeName,
      category: row.category || (locale === "en" ? "General" : "Genel"),
      subscription: moneyLabel(row.priceCents),
      isPaid: row.hasActiveSubscription || ["active", "trialing"].includes((row.status ?? "").toLowerCase()),
      hasActiveAutomationWebhook: row.hasActiveAutomationWebhook ?? false,
      orderCount: row.orderCount ?? 0,
      url: "",
      plan: row.plan,
      subscriptionStatus: row.subscriptionStatus,
      automationIntervalHours: row.automationIntervalHours,
      automationLastRunAt: row.automationLastRunAt,
      lastSuccessfulAutomationAt: row.lastSuccessfulAutomationAt ?? row.automationLastRunAt ?? null,
      nextAutomationAt: row.nextAutomationAt,
      automationState: row.automationState ?? "waiting",
      canDelete: row.canDelete,
      deleteBlockedReason: row.deleteBlockedReason,
    }),
    [locale]
  );

  const syncServerSession = useCallback(async () => {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session?.access_token) {
      return false;
    }

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });

    return response.ok;
  }, []);

  const requestStoresOverview = useCallback(async () => {
    const response = await fetch("/api/stores/overview", {
      cache: "no-store",
      credentials: "include",
    });

    const payload = (await response.json().catch(() => ({}))) as StoreOverviewResponse;
    return { response, payload };
  }, []);

  const requestStoreQuota = useCallback(async () => {
    const response = await fetch("/api/stores/quota", {
      cache: "no-store",
      credentials: "include",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      quota?: StoreQuotaPayload;
      error?: string;
    };

    return { response, payload };
  }, []);

  const loadStoreQuota = useCallback(async () => {
    let { response, payload } = await requestStoreQuota();

    if (response.status === 401) {
      const synced = await syncServerSession();
      if (synced) {
        ({ response, payload } = await requestStoreQuota());
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(locale === "en" ? "Session expired. Please sign in again." : "Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      }

      throw new Error(payload.error || (locale === "en" ? "Store quota could not be loaded" : "Mağaza kotası yüklenemedi"));
    }

    setStoreQuota(payload.quota ?? null);
  }, [locale, requestStoreQuota, syncServerSession]);

  const getFreshStoreQuota = useCallback(async () => {
    let { response, payload } = await requestStoreQuota();

    if (response.status === 401) {
      const synced = await syncServerSession();
      if (synced) {
        ({ response, payload } = await requestStoreQuota());
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(locale === "en" ? "Session expired. Please sign in again." : "Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      }

      throw new Error(payload.error || (locale === "en" ? "Store quota could not be loaded" : "Mağaza kotası yüklenemedi"));
    }

    const quota = payload.quota ?? null;
    setStoreQuota(quota);
    return quota;
  }, [locale, requestStoreQuota, syncServerSession]);

  const loadStoresOverview = useCallback(async () => {
    let { response, payload } = await requestStoresOverview();

    if (response.status === 401) {
      const synced = await syncServerSession();

      if (synced) {
        ({ response, payload } = await requestStoresOverview());
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(locale === "en" ? "Session expired. Please sign in again." : "Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      }

      throw new Error(payload.error || (locale === "en" ? "Stores could not be loaded" : "Mağazalar yüklenemedi"));
    }

    const rows = payload.rows ?? [];
    setShops(rows.map(mapOverviewRowToShop));
  }, [locale, mapOverviewRowToShop, requestStoresOverview, setShops, syncServerSession]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        await Promise.all([loadStoresOverview(), loadStoreQuota()]);
      } catch {
        if (mounted) {
          setShops([]);
          setStoreQuota(null);
        }
      }
    };

    void boot();

    return () => {
      mounted = false;
    };
  }, [loadStoreQuota, loadStoresOverview, setShops]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void Promise.all([loadStoresOverview(), loadStoreQuota()]).catch(() => undefined);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadStoreQuota, loadStoresOverview]);

  useEffect(() => {
    if (showConnect && isStoreCreationLocked) {
      setShowConnect(false);
    }
  }, [isStoreCreationLocked, showConnect]);

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setStoreActionMessage(null);

    try {
      if (isStoreCreationLocked) {
        throw new Error(
          locale === "en"
            ? "Store limit reached. Buy an extra store slot or upgrade your plan."
            : "Mağaza limitiniz doldu. Ek mağaza hakkı satın alın veya planınızı yükseltin."
        );
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Oturum bulunamadı.");
      }

      const sessionSync = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      });
      if (!sessionSync.ok) {
        throw new Error("Oturum senkronize edilemedi.");
      }

      const latestQuota = await getFreshStoreQuota();
      if (latestQuota && !latestQuota.canCreateStore) {
        throw new Error(
          latestQuota.plan === "turbo"
            ? "Mağaza limitiniz doldu. Yeni mağaza için +$10 ek mağaza paketi satın alabilir veya mevcut mağazalarınızı düzenleyebilirsiniz."
            : "Mağaza limitiniz doldu. Yeni mağaza için +$20 ek mağaza paketi satın alabilir veya planınızı yükseltebilirsiniz."
        );
      }

      const normalizedPhone = phone.trim();

      if (!normalizedPhone) {
        throw new Error("Telefon numarası zorunlu.");
      }

      const categoryName = categories.find((category) => category.id === selectedCat)?.name || "Genel";
      const response = await fetch("/api/onboarding/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: shopName.trim() || null,
          phone: normalizedPhone,
          category: categoryName,
          priceCents: 2990,
          fallbackStoreNamePrefix: locale === "en" ? "My Store" : "Mağazam",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };

      if (!response.ok || !payload.id) {
        if (response.status === 409) {
          const limitPayload = payload as { code?: string; quota?: StoreQuotaPayload; error?: string };
          if (limitPayload.code === "STORE_LIMIT_REACHED") {
            if (limitPayload.quota) {
              setStoreQuota(limitPayload.quota);
            }
            throw new Error(
              limitPayload.error ||
                (locale === "en"
                  ? "Store limit reached. Buy an extra store slot or upgrade your plan."
                  : "Mağaza limitiniz doldu. Ek mağaza hakkı satın alın veya planınızı yükseltin.")
            );
          }
        }

        throw new Error(payload.error || "Mağaza eklenemedi");
      }

      await Promise.all([loadStoresOverview(), loadStoreQuota()]);

      setShowConnect(false);
      setPhone("");
      setShopName("");
      setSelectedCat(categories[0]?.id ?? "");
      setStoreActionMessage({
        type: "success",
        text: locale === "en" ? "Store added successfully." : "Mağaza başarıyla eklendi.",
      });
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Mağaza eklenemedi",
      });
    }
  };

  const handleOpenUpgradePortal = async () => {
    if (isOpeningUpgradePortal) {
      return;
    }

    setIsOpeningUpgradePortal(true);
    setStoreActionMessage(null);

    try {
      const response = await fetch("/api/settings/subscription/upgrade", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(
          payload.error ||
            (locale === "en" ? "Upgrade portal could not be opened." : "Plan yükseltme ekranı açılamadı.")
        );
      }

      window.location.href = payload.url;
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : locale === "en"
              ? "Upgrade portal could not be opened."
              : "Plan yükseltme ekranı açılamadı.",
      });
      setIsOpeningUpgradePortal(false);
    }
  };

  const handleBuyExtraStoreSlot = async () => {
    if (isBuyingExtraStoreSlot) {
      return;
    }

    setIsBuyingExtraStoreSlot(true);
    setStoreActionMessage(null);

    try {
      const response = await fetch("/api/billing/store-capacity-checkout", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(
          payload.error ||
            (locale === "en"
              ? "Extra store checkout could not be opened."
              : "Ek mağaza ödeme ekranı açılamadı.")
        );
      }

      window.location.href = payload.url;
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : locale === "en"
              ? "Extra store checkout could not be opened."
              : "Ek mağaza ödeme ekranı açılamadı.",
      });
      setIsBuyingExtraStoreSlot(false);
    }
  };

  const crispWebsiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? DEFAULT_CRISP_WEBSITE_ID;

  const openCrispChatbox = () => {
    const crispWindow = window as Window & {
      $crisp?: Array<unknown> & { push: (item: unknown) => number };
    };

    if (!crispWindow.$crisp || typeof crispWindow.$crisp.push !== "function") {
      return false;
    }

    crispWindow.$crisp.push(["do", "chat:show"]);
    crispWindow.$crisp.push(["do", "chat:open"]);
    return true;
  };

  const ensureCrispScript = () => {
    const crispWindow = window as Window & {
      $crisp?: Array<unknown>;
      CRISP_WEBSITE_ID?: string;
    };

    if (!crispWindow.$crisp) {
      crispWindow.$crisp = [];
    }

    if (!crispWindow.CRISP_WEBSITE_ID) {
      crispWindow.CRISP_WEBSITE_ID = crispWebsiteId;
    }

    if (document.getElementById("crisp-chat-script")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "crisp-chat-script";
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.head.appendChild(script);
  };

  const handleOpenSupport = () => {
    setStoreActionMessage(null);

    if (openCrispChatbox()) {
      return;
    }

    ensureCrispScript();

    let attempts = 0;
    const maxAttempts = 20;
    const poll = window.setInterval(() => {
      attempts += 1;

      if (openCrispChatbox()) {
        window.clearInterval(poll);
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(poll);
        setStoreActionMessage({
          type: "error",
          text:
            locale === "en"
              ? "Support chat is still loading. Please try again in a few seconds."
              : "Destek sohbeti hala yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.",
        });
      }
    }, 150);
  };

  const getRemainingSeconds = (shop: Shop) => {
    const intervalHours = shop.automationIntervalHours;
    if (!intervalHours || intervalHours <= 0) {
      return null;
    }

    const nextAutomationAtMs = shop.nextAutomationAt ? new Date(shop.nextAutomationAt).getTime() : Number.NaN;
    if (!Number.isFinite(nextAutomationAtMs)) {
      return null;
    }

    const diffSeconds = Math.ceil((nextAutomationAtMs - nowTs) / 1000);
    return Math.max(0, diffSeconds);
  };

  const formatRemaining = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}${t("etsy.countdownHoursShort")} ${minutes}${t("etsy.countdownMinutesShort")} ${seconds}${t("etsy.countdownSecondsShort")}`;
    }

    return `${minutes}${t("etsy.countdownMinutesShort")} ${seconds}${t("etsy.countdownSecondsShort")}`;
  };

  const getAutomationText = (shop: Shop) => {
    if (!shop.plan || !shop.isPaid) {
      return t("etsy.automationNoPlan");
    }

    const remainingSeconds = getRemainingSeconds(shop);

    if (remainingSeconds === null) {
      return t("etsy.automationUnavailable");
    }

    return `${t("etsy.nextUploadIn")}: ${formatRemaining(remainingSeconds)}`;
  };

  const getDeleteBlockedMessage = (reason: Shop["deleteBlockedReason"]) => {
    if (reason === "active_subscription") {
      return t("etsy.deleteBlockedSubscription");
    }

    if (reason === "automation_running") {
      return t("etsy.deleteBlockedAutomation");
    }

    return t("etsy.deleteStoreWarning");
  };

  const handleDeleteIntent = (shop: Shop) => {
    setStoreActionMessage(null);

    if (!shop.canDelete) {
      setStoreActionMessage({
        type: "error",
        text: getDeleteBlockedMessage(shop.deleteBlockedReason ?? null),
      });
      return;
    }

    setDeleteTargetShop(shop);
  };

  const handleConfirmDeleteStore = async () => {
    if (!deleteTargetShop) {
      return;
    }

    setIsDeletingStoreId(deleteTargetShop.id);

    try {
      const response = await fetch(`/api/stores/${deleteTargetShop.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: Shop["deleteBlockedReason"];
      };

      if (!response.ok) {
        if (response.status === 409) {
          const blockedReason = payload.reason ?? null;
          setStoreActionMessage({
            type: "error",
            text: getDeleteBlockedMessage(blockedReason),
          });
          setDeleteTargetShop(null);
          return;
        }

        throw new Error(payload.error || t("etsy.deleteStoreWarning"));
      }

      setStoreActionMessage({
        type: "success",
        text: t("etsy.deleteStoreSuccess"),
      });

      setDeleteTargetShop(null);
      await loadStoresOverview();
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("etsy.deleteStoreWarning"),
      });
    } finally {
      setIsDeletingStoreId(null);
    }
  };

  return (
    <div className="w-full p-5 h-full overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black mb-1 tracking-tight text-white">{t("etsy.title")}</h1>
          <p className="text-slate-500 text-sm font-medium">{t("etsy.subtitle")}</p>
          {storeQuota ? (
            <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black tracking-wide text-slate-300">
              <span>
                {t("etsy.storeQuotaLabel")}: {storeQuota.totalStores}/{storeQuota.includedStoreLimit + storeQuota.purchasedExtraStores}
              </span>
              <span className="text-slate-500">•</span>
              <span>
                {t("etsy.storeQuotaRemaining")}: {Math.max(0, storeQuota.remainingSlots)}
              </span>
            </div>
          ) : null}
        </div>
        {!isStoreCreationLocked ? (
          <button
            onClick={() => setShowConnect(true)}
            className="px-8 py-4 rounded-2xl bg-indigo-600 text-white font-black flex items-center gap-3 hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] active:scale-95 transition-all text-sm uppercase tracking-widest cursor-pointer"
          >
            <Plus className="w-5 h-5" /> {t("etsy.addStore")}
          </button>
        ) : null}
      </div>

      {storeQuota && !storeQuota.canCreateStore ? (
        <div className="mb-8 rounded-2xl border border-white/5 bg-white/5 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-amber-300 mb-2">
            {t("etsy.storeLimitReachedTitle")}
          </p>
          <p className="text-sm text-amber-100 mb-4">
            {t("etsy.storeLimitReachedText")}{" "}
            <span className="font-black">{currencyFormatter.format(storeQuota.extraStorePriceCents / 100)}</span>
          </p>

          <div className="flex flex-wrap gap-3 mb-4">
            <button
              type="button"
              onClick={() => void handleBuyExtraStoreSlot()}
              disabled={isBuyingExtraStoreSlot}
              className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-60 cursor-pointer inline-flex items-center gap-2"
            >
              {isBuyingExtraStoreSlot ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isBuyingExtraStoreSlot ? t("etsy.buyExtraStoreLoading") : t("etsy.buyExtraStore")}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenUpgradePortal()}
              disabled={isOpeningUpgradePortal}
              className="px-4 py-2 rounded-xl border border-white/20 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-60 cursor-pointer inline-flex items-center gap-2"
            >
              {isOpeningUpgradePortal ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isOpeningUpgradePortal ? t("etsy.upgradePlanLoading") : t("etsy.upgradePlan")}
            </button>
          </div>

          {storeQuota.upgradeOptions.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {storeQuota.upgradeOptions.map((option) => (
                <div key={option.plan} className="rounded-xl border border-white/10 bg-[#0d1016] px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1">
                    {planLabel(option.plan)}
                  </p>
                  <p className="text-xs text-slate-300 mb-1">
                    {option.includedStores} {t("etsy.storeLimitUnit")}
                  </p>
                  <p className="text-sm font-black text-white">{currencyFormatter.format(option.monthlyPriceCents / 100)}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <button
          onClick={handleOpenSupport}
          className="glass-card-pro p-4 rounded-[20px] border border-white/5 relative overflow-hidden group flex items-center gap-3 text-left hover:border-emerald-500/30 transition-all cursor-pointer"
        >
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20 shrink-0">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-0.5">{t("etsy.support")}</h3>
            <div className="text-sm font-black text-emerald-400">{t("etsy.supportValue")}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 mt-1">{t("etsy.supportWhatsappCta")}</div>
          </div>
        </button>

        <div className="glass-card-pro p-4 rounded-[20px] border border-white/5 relative overflow-hidden group flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center border border-indigo-500/20 shrink-0">
            <Package className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-0.5">{t("etsy.orders")}</h3>
            <div className="text-sm font-black text-white">
              {shops.reduce((acc, shop) => acc + shop.orderCount, 0)} {t("etsy.totalShipment")}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-10">
        <div className="px-4 mb-4">
          <h2 className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.3em]">{t("etsy.storesTitle")}</h2>
        </div>

        {storeActionMessage && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              storeActionMessage.type === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {storeActionMessage.text}
          </div>
        )}

        {shops.length === 0 ? (
          <div className="py-20 glass-pro rounded-[40px] text-center border border-dashed border-indigo-500/20">
            <Store className="w-16 h-16 text-indigo-500/20 mx-auto mb-6" />
            <p className="text-slate-500 font-black text-sm uppercase tracking-widest">{t("etsy.emptyStores")}</p>
          </div>
        ) : (
          <div className="etsy-stores-grid">
            {shops.map((shop, index) => {
              const showTimer = hoveredTimerStoreId === shop.id || pinnedTimerStoreId === shop.id;
              const automationText = getAutomationText(shop);
              const isStoreActiveByPlan = shop.isPaid || Boolean(storeQuota?.hasActiveSubscription);
              const showAutomationIndicator = isStoreActiveByPlan && Boolean(shop.hasActiveAutomationWebhook);

              return (
                <motion.div
                  key={shop.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative overflow-visible rounded-[28px] glass-card-pro border border-white/5 p-5 group hover:border-indigo-500/30 transition-all duration-500 flex flex-col gap-4 min-h-[270px]"
                >
                  {showAutomationIndicator && (
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredTimerStoreId(shop.id)}
                      onMouseLeave={() => setHoveredTimerStoreId((prev) => (prev === shop.id ? null : prev))}
                      onClick={() => setPinnedTimerStoreId((prev) => (prev === shop.id ? null : shop.id))}
                      className="absolute left-3 top-3 h-6 w-6 rounded-full border border-indigo-400/40 bg-indigo-500/15 text-indigo-300 flex items-center justify-center hover:bg-indigo-500/25 transition-all cursor-pointer"
                      title={automationText}
                    >
                      <Cog className="w-3.5 h-3.5 animate-spin" />
                    </button>
                  )}

                  {showAutomationIndicator && showTimer && (
                    <div className="absolute left-3 top-10 z-10 min-w-[190px] rounded-xl border border-indigo-500/30 bg-[#0e1016] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-indigo-200 shadow-2xl">
                      <p className="text-indigo-300/80 mb-1">{t("etsy.automationActiveBadge")}</p>
                      <p className="text-white/90 normal-case tracking-normal text-xs">{automationText}</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeleteIntent(shop)}
                    className={`absolute -right-3 -top-3 h-8 w-8 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-xl backdrop-blur-sm ${
                      shop.canDelete
                        ? "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        : "border-slate-600/40 bg-slate-500/10 text-slate-400 hover:bg-slate-500/20"
                    }`}
                    title={shop.canDelete ? t("etsy.deleteStore") : getDeleteBlockedMessage(shop.deleteBlockedReason ?? null)}
                  >
                    <X className="w-4 h-4" />
                  </button>

                  <div className="flex items-start gap-4 pr-4">
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-500 ${
                        isStoreActiveByPlan
                          ? "bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                          : "bg-indigo-600/10 border-indigo-500/20"
                      }`}
                    >
                      <Store className={`w-7 h-7 ${isStoreActiveByPlan ? "text-emerald-400" : "text-indigo-400"}`} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-white truncate">{shop.name}</h3>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                          {shop.category}
                        </span>
                        {shop.plan ? (
                          <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            {planLabel(shop.plan)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 mt-auto">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("etsy.orders")}</p>
                    <p className="text-base font-black text-white">{shop.orderCount}</p>
                  </div>

                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {deleteTargetShop && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => isDeletingStoreId === null && setDeleteTargetShop(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg p-8 rounded-[32px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2">{t("etsy.deleteStoreConfirmTitle")}</h3>
              <p className="text-slate-300 text-sm mb-3">{t("etsy.deleteStoreConfirmText")}</p>
              <p className="text-slate-500 text-xs font-bold mb-6">{t("etsy.deleteStoreWarning")}</p>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white mb-6">
                {deleteTargetShop.name}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTargetShop(null)}
                  disabled={isDeletingStoreId === deleteTargetShop.id}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t("etsy.cancel")}
                </button>
                <button
                  onClick={() => void handleConfirmDeleteStore()}
                  disabled={isDeletingStoreId === deleteTargetShop.id}
                  className="flex-1 py-3 rounded-xl bg-red-600/90 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isDeletingStoreId === deleteTargetShop.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("etsy.deleteStoreApprove")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConnect && !isStoreCreationLocked && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConnect(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className="relative w-full max-w-xl p-10 rounded-[48px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-indigo-600 rounded-[28px] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-indigo-400/30">
                  <Store className="text-white w-10 h-10" />
                </div>
                <h2 className="text-3xl font-black text-white tracking-tight mb-2">Mağaza Kaydı</h2>
                <p className="text-slate-500 font-bold">Kaydı tamamlayın, uzman ekibimiz sizi arasın.</p>
              </div>

              <form onSubmit={handleConnect} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mağaza Adı</label>
                    <input
                      type="text"
                      required
                      value={shopName}
                      onChange={(event) => setShopName(event.target.value)}
                      placeholder="Örn: WoodDesignTR"
                      className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Telefon No</label>
                    <div className="relative">
                      <Smartphone className="absolute left-4 top-4.5 w-4 h-4 text-slate-500" />
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="+90 5xx..."
                        className="w-full pl-12 pr-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Kategori Seçimi</label>
                  <select
                    value={selectedCat}
                    onChange={(event) => setSelectedCat(event.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium appearance-none"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id} className="bg-[#0a0a0c]">
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-6 rounded-[28px] bg-indigo-500/5 border border-indigo-500/10">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-slate-400 leading-relaxed font-bold">
                      Ödeme yapıldıktan sonra sistemimiz sizi bilgilendirecek ve ekibimiz
                      <span className="text-white"> mağazanız için otomasyonu devreye alacak.</span>
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowConnect(false)}
                    className="flex-1 py-4 rounded-2xl glass-pro border border-white/5 font-black text-xs uppercase tracking-widest text-slate-400 hover:text-white transition-all cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={isStoreCreationLocked}
                    className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
                  >
                    Mağazayı Ekle
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EtsyPanel;
