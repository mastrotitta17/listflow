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
  Check,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { Select } from "@/components/ui/select";
import type { Shop } from "@/types";

type BillingPlan = "standard" | "pro" | "turbo";
type BillingInterval = "month" | "year";

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

type StoreActionMessage = {
  type: "success" | "error";
  text: string;
};

type ActivationModalState = {
  shop: Shop;
  plan: BillingPlan;
  interval: BillingInterval;
};

type PlanFeature = {
  text: string;
  upcoming?: boolean;
};

type PlanDetails = {
  cadence: string;
  description: string;
  features: PlanFeature[];
};

const DEFAULT_CRISP_WEBSITE_ID = "90902ea5-80af-4468-8f9d-d9a808ed1137";
const PLAN_ORDER: BillingPlan[] = ["standard", "pro", "turbo"];
const PLAN_PRICE_CENTS: Record<BillingPlan, { month: number; year: number }> = {
  standard: { month: 2990, year: 26910 },
  pro: { month: 4990, year: 44910 },
  turbo: { month: 7990, year: 71910 },
};
const DISPLAY_DISCOUNT_PERCENT: Record<BillingInterval, number> = {
  month: 50,
  year: 50,
};
const LISTFLOW_DECIDE_VALUE = "__listflow_decide__";
type StoreCurrency = "USD" | "TRY";

const resolveShopPlan = (value: string | null | undefined): BillingPlan => {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "pro" || normalized === "turbo") {
    return normalized;
  }

  return "standard";
};

const EtsyPanel: React.FC = () => {
  const { shops, setShops } = useStore();
  const { t, locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);
  const [showConnect, setShowConnect] = useState(false);
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [selectedParentCategoryId, setSelectedParentCategoryId] = useState("");
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState("");
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>("USD");
  const [storeActionMessage, setStoreActionMessage] = useState<StoreActionMessage | null>(null);
  const [activationModal, setActivationModal] = useState<ActivationModalState | null>(null);
  const [activationSubmitting, setActivationSubmitting] = useState(false);
  const [hoveredTimerStoreId, setHoveredTimerStoreId] = useState<string | null>(null);
  const [pinnedTimerStoreId, setPinnedTimerStoreId] = useState<string | null>(null);
  const [deleteTargetShop, setDeleteTargetShop] = useState<Shop | null>(null);
  const [isDeletingStoreId, setIsDeletingStoreId] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const topCategories = useMemo(() => categories, [categories]);

  const selectedParentCategory = useMemo(
    () => topCategories.find((category) => category.id === selectedParentCategoryId) ?? topCategories[0] ?? null,
    [selectedParentCategoryId, topCategories]
  );

  const availableSubCategories = useMemo(() => {
    if (!selectedParentCategory) {
      return [];
    }

    return (selectedParentCategory.subProducts ?? [])
      .map((subProduct) => ({
        id: subProduct.id,
        name: subProduct.name,
      }))
      .filter((item) => Boolean(item.id) && Boolean(item.name));
  }, [selectedParentCategory]);

  const resolvedSubCategory = useMemo(() => {
    if (!availableSubCategories.length) {
      return null;
    }

    if (selectedSubCategoryId === LISTFLOW_DECIDE_VALUE || !selectedSubCategoryId) {
      return availableSubCategories[0];
    }

    return availableSubCategories.find((subcategory) => subcategory.id === selectedSubCategoryId) ?? availableSubCategories[0];
  }, [availableSubCategories, selectedSubCategoryId]);

  useEffect(() => {
    if (!selectedParentCategoryId && topCategories[0]) {
      setSelectedParentCategoryId(topCategories[0].id);
    }
  }, [selectedParentCategoryId, topCategories]);

  useEffect(() => {
    if (!availableSubCategories.length) {
      if (selectedSubCategoryId !== "") {
        setSelectedSubCategoryId("");
      }
      return;
    }

    if (
      selectedSubCategoryId &&
      selectedSubCategoryId !== LISTFLOW_DECIDE_VALUE &&
      availableSubCategories.some((subcategory) => subcategory.id === selectedSubCategoryId)
    ) {
      return;
    }

    setSelectedSubCategoryId(LISTFLOW_DECIDE_VALUE);
  }, [availableSubCategories, selectedSubCategoryId]);

  const moneyLabel = (priceCents: number) => {
    return `$${(priceCents / 100).toFixed(2)}`;
  };

  const planLabel = (plan: string | null | undefined) => {
    const normalized = (plan ?? "").toLowerCase();

    if (normalized === "standard") return t("dashboard.planStandard");
    if (normalized === "pro") return t("dashboard.planPro");
    if (normalized === "turbo") return t("dashboard.planTurbo");

    return t("dashboard.planUnknown");
  };

  const planDetails = useMemo<Record<BillingPlan, PlanDetails>>(
    () => ({
      standard: {
        cadence: t("etsy.planDetailsStandardCadence"),
        description: t("etsy.planDetailsStandardDescription"),
        features: [
          { text: t("etsy.planDetailsStandardFeature1") },
          { text: t("etsy.planDetailsStandardFeature2") },
          { text: t("etsy.planDetailsStandardFeature3") },
          { text: t("etsy.planDetailsStandardFeature4") },
          { text: t("etsy.planDetailsStandardFeature5") },
          { text: t("etsy.planDetailsStandardFeature6") },
          { text: t("etsy.planDetailsStandardFeature7") },
          { text: t("etsy.planDetailsStandardFeature8") },
        ],
      },
      pro: {
        cadence: t("etsy.planDetailsProCadence"),
        description: t("etsy.planDetailsProDescription"),
        features: [
          { text: t("etsy.planDetailsProFeature1") },
          { text: t("etsy.planDetailsProFeature2") },
          { text: t("etsy.planDetailsProFeature3") },
          { text: t("etsy.planDetailsProFeature4") },
          { text: t("etsy.planDetailsProFeature5") },
          { text: t("etsy.planDetailsProFeature6") },
          { text: t("etsy.planDetailsProFeature7") },
          { text: t("etsy.planDetailsProFeature8") },
        ],
      },
      turbo: {
        cadence: t("etsy.planDetailsTurboCadence"),
        description: t("etsy.planDetailsTurboDescription"),
        features: [
          { text: t("etsy.planDetailsTurboFeature1") },
          { text: t("etsy.planDetailsTurboFeature2") },
          { text: t("etsy.planDetailsTurboFeature3") },
          { text: t("etsy.planDetailsTurboFeature4") },
          { text: t("etsy.planDetailsTurboFeature5") },
          { text: t("etsy.planDetailsTurboFeature6") },
          { text: t("etsy.planDetailsTurboFeature7") },
          { text: t("etsy.planDetailsTurboFeature8") },
        ],
      },
    }),
    [t]
  );

  const formatUsd = (cents: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);

  const getOriginalCentsFromDiscounted = (discountedCents: number, interval: BillingInterval) => {
    const discountPercent = DISPLAY_DISCOUNT_PERCENT[interval];
    const divisor = 1 - discountPercent / 100;

    if (divisor <= 0) {
      return discountedCents;
    }

    return Math.round(discountedCents / divisor);
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
        await loadStoresOverview();
      } catch {
        if (mounted) {
          setShops([]);
        }
      }
    };

    void boot();

    return () => {
      mounted = false;
    };
  }, [loadStoresOverview, setShops]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadStoresOverview().catch(() => undefined);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadStoresOverview]);

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setStoreActionMessage(null);

    try {
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

      const normalizedPhone = phone.trim();

      if (!normalizedPhone) {
        throw new Error("Telefon numarası zorunlu.");
      }

      const categoryName = resolvedSubCategory?.name || selectedParentCategory?.name || (locale === "en" ? "General" : "Genel");
      const topCategoryId =
        (selectedParentCategory?.dbId && selectedParentCategory.dbId.trim()) ||
        (selectedParentCategory?.id && selectedParentCategory.id.trim()) ||
        null;
      const subCategoryId = (resolvedSubCategory?.id && resolvedSubCategory.id.trim()) || null;
      const response = await fetch("/api/onboarding/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: shopName.trim() || null,
          phone: normalizedPhone,
          category: categoryName,
          topCategoryId,
          subCategoryId,
          currency: storeCurrency,
          priceCents: 2990,
          fallbackStoreNamePrefix: locale === "en" ? "My Store" : "Mağazam",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Mağaza eklenemedi");
      }

      await loadStoresOverview();

      setShowConnect(false);
      setPhone("");
      setShopName("");
      setSelectedParentCategoryId(topCategories[0]?.id ?? "");
      setSelectedSubCategoryId(topCategories.length ? LISTFLOW_DECIDE_VALUE : "");
      setStoreCurrency("USD");
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

  const handleActivateStore = (shop: Shop) => {
    setStoreActionMessage(null);
    setActivationModal({
      shop,
      plan: resolveShopPlan(shop.plan),
      interval: "month",
    });
  };

  const handleStartActivationCheckout = async () => {
    if (!activationModal) {
      return;
    }

    setActivationSubmitting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(locale === "en" ? "Session expired. Please sign in again." : "Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      }

      const sessionSync = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      });

      if (!sessionSync.ok) {
        throw new Error(locale === "en" ? "Session sync failed." : "Oturum senkronize edilemedi.");
      }

      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "subscription",
          plan: activationModal.plan,
          interval: activationModal.interval,
          shopId: activationModal.shop.id,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(
          payload.error ||
            (locale === "en"
              ? "Activation checkout could not be started."
              : "Aktivasyon ödeme ekranı açılamadı.")
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
              ? "Activation checkout could not be started."
            : "Aktivasyon ödeme ekranı açılamadı.",
      });
      setActivationSubmitting(false);
    }
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
        </div>
        <button
          onClick={() => setShowConnect(true)}
          className="px-8 py-4 rounded-2xl bg-indigo-600 text-white font-black flex items-center gap-3 hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] active:scale-95 transition-all text-sm uppercase tracking-widest cursor-pointer"
        >
          <Plus className="w-5 h-5" /> {t("etsy.addStore")}
        </button>
      </div>

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
              const isStoreActiveByPlan = shop.isPaid;
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

                  <div className="pt-1">
                    {shop.isPaid ? (
                      <span className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-emerald-300">
                        {t("etsy.paymentDone")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleActivateStore(shop)}
                        className="w-full rounded-xl border border-indigo-500/40 bg-indigo-600/80 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white hover:bg-indigo-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        {t("etsy.activatePay")}
                      </button>
                    )}
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
        {activationModal && (
          <div className="fixed inset-0 z-[125] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !activationSubmitting && setActivationModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              className="relative w-full max-w-5xl rounded-[32px] glass-card-pro border border-white/10 p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <h3 className="text-2xl font-black text-white mb-1">{t("etsy.activateModalTitle")}</h3>
              <p className="text-slate-300 text-sm mb-5">{t("etsy.activateModalSubtitle")}</p>
              <p className="text-[11px] text-indigo-300 font-black uppercase tracking-widest mb-4">
                {activationModal.shop.name}
              </p>

              <div className="mb-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setActivationModal((prev) => (prev ? { ...prev, interval: "month" } : prev))}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all cursor-pointer ${
                    activationModal.interval === "month"
                      ? "bg-indigo-600 text-white border-indigo-500/60"
                      : "bg-white/5 text-slate-300 border-white/10"
                  }`}
                >
                  {t("etsy.billingMonthly")}
                </button>
                <button
                  type="button"
                  onClick={() => setActivationModal((prev) => (prev ? { ...prev, interval: "year" } : prev))}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all cursor-pointer ${
                    activationModal.interval === "year"
                      ? "bg-indigo-600 text-white border-indigo-500/60"
                      : "bg-white/5 text-slate-300 border-white/10"
                  }`}
                >
                  {t("etsy.billingYearly")}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                {PLAN_ORDER.map((planKey) => {
                  const selected = activationModal.plan === planKey;
                  const amount = PLAN_PRICE_CENTS[planKey][activationModal.interval];
                  const originalAmount = getOriginalCentsFromDiscounted(amount, activationModal.interval);
                  const discountPercent = DISPLAY_DISCOUNT_PERCENT[activationModal.interval];
                  const details = planDetails[planKey];
                  return (
                    <button
                      key={planKey}
                      type="button"
                      onClick={() => setActivationModal((prev) => (prev ? { ...prev, plan: planKey } : prev))}
                      className={`rounded-2xl border p-4 text-left transition-all cursor-pointer ${
                        selected
                          ? "border-indigo-400/60 bg-indigo-500/20"
                          : "border-white/10 bg-white/5 hover:border-indigo-400/30"
                      }`}
                    >
                      <p className="text-[10px] text-indigo-300 font-black uppercase tracking-widest mb-1">
                        {planLabel(planKey)}
                      </p>
                      <p className="text-[10px] text-slate-400 mb-1">{details.cadence}</p>
                      <p className="text-[11px] text-slate-300 mb-2">{details.description}</p>
                      <div className="flex items-end gap-2 mb-2">
                        <p className="text-white text-3xl font-black leading-none">{formatUsd(amount)}</p>
                        <p className="text-slate-500 text-sm line-through font-bold">{formatUsd(originalAmount)}</p>
                      </div>
                      <p className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300">
                        %{discountPercent}
                      </p>
                      <ul className="mt-3 space-y-1.5">
                        {details.features.map((feature) => (
                          <li key={feature.text} className="flex items-start gap-2">
                            <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-indigo-400/35 bg-indigo-500/10 text-indigo-300">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                            <span className="text-[11px] text-slate-200 leading-snug">
                              {feature.text}
                              {feature.upcoming ? (
                                <span className="ml-1 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] text-amber-300">
                                  {t("common.comingSoon")}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setActivationModal(null)}
                  disabled={activationSubmitting}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t("etsy.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartActivationCheckout()}
                  disabled={activationSubmitting}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {activationSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {activationSubmitting ? t("etsy.activatePayLoading") : t("etsy.activatePay")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConnect && (
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

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                      {locale === "en" ? "Main Category" : "Ana Kategori"}
                    </label>
                    <Select
                      value={selectedParentCategoryId}
                      onChange={(event) => setSelectedParentCategoryId(event.target.value)}
                    >
                      {topCategories.length === 0 ? (
                        <option value="" disabled>
                          {locale === "en" ? "No categories found" : "Kategori bulunamadı"}
                        </option>
                      ) : null}
                      {topCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                      {locale === "en" ? "Subcategory" : "Alt Kategori"}
                    </label>
                    <Select
                      value={availableSubCategories.length ? selectedSubCategoryId : ""}
                      onChange={(event) => setSelectedSubCategoryId(event.target.value)}
                      disabled={!availableSubCategories.length}
                    >
                      {availableSubCategories.length ? (
                        <option value={LISTFLOW_DECIDE_VALUE}>
                          {locale === "en" ? "Let Listflow decide" : "Listflow karar versin"}
                        </option>
                      ) : (
                        <option value="" disabled>
                          {locale === "en" ? "No subcategory for selected main category" : "Seçili ana kategori için alt kategori yok"}
                        </option>
                      )}
                      {availableSubCategories.map((subcategory) => (
                        <option key={subcategory.id} value={subcategory.id}>
                          {subcategory.name}
                        </option>
                      ))}
                    </Select>
                    {availableSubCategories.length && selectedSubCategoryId === LISTFLOW_DECIDE_VALUE ? (
                      <p className="text-[10px] text-indigo-300 font-semibold">
                        {locale === "en"
                          ? `Listflow selected: ${resolvedSubCategory?.name || "-"}`
                          : `Listflow seçimi: ${resolvedSubCategory?.name || "-"}`}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 border border-white/10 py-2 px-3 rounded-xl flex justify-between items-center w-full">
                  <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    {locale === "en" ? "Store Currency" : "Mağaza Para Birimi"}
                  </label>
                  </div>
                  <div className="inline-flex rounded-full border border-indigo-500/25 bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setStoreCurrency("USD")}
                      className={`rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                        storeCurrency === "USD"
                          ? "bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.35)]"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      $ Dolar
                    </button>
                    <button
                      type="button"
                      onClick={() => setStoreCurrency("TRY")}
                      className={`rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                        storeCurrency === "TRY"
                          ? "bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.35)]"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      ₺ Türk Lirası
                    </button>
                  </div>
                </div>
                  <p className="text-[10px] text-slate-500 font-semibold">
                    {locale === "en" ? "Default currency is USD." : "Varsayılan para birimi dolardır."}
                  </p>

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
