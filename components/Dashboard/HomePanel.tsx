"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Boxes,
  CircleAlert,
  CircleCheckBig,
  Clock3,
  Download,
  Layers3,
  Package,
  RefreshCcw,
  Sparkles,
  Store,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n/provider";
import { DashboardHomePanelSkeleton } from "@/components/loading/PageSkeletons";

type SummaryResponse = {
  userId: string;
  profile: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    isComplete: boolean;
  };
  plan: {
    plan: string | null;
    status: string | null;
  };
  stats: {
    storeCount: number;
    activeStoreCount: number;
    renewalRequiredCount: number;
    activationRequiredCount: number;
    automationEnabledCount: number;
    totalProductsCount: number;
    readyProductsCount: number;
    failedProductsCount: number;
    totalOrdersCount: number;
    paidOrdersCount: number;
  };
  stores: Array<{
    id: string;
    name: string;
    renewalState: "active" | "renewal_required" | "activation_required";
    hasAutomation: boolean;
  }>;
};

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
};

const EXTENSION_CHECK_KEY_PREFIX = "listflow:dashboard-extension-check:";

const planBadgeClass = (plan: string | null) => {
  switch ((plan ?? "").toLowerCase()) {
    case "turbo":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "pro":
      return "border-indigo-400/30 bg-indigo-400/10 text-indigo-200";
    case "standard":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    default:
      return "border-white/10 bg-white/5 text-slate-200";
  }
};

const formatPlanLabel = (plan: string | null, locale: string) => {
  const normalized = (plan ?? "").toLowerCase();
  if (normalized === "turbo") return "Turbo";
  if (normalized === "pro") return "Pro";
  if (normalized === "standard") return locale === "en" ? "Starter" : "Starter";
  return locale === "en" ? "Free" : "Ücretsiz";
};

const statusToneClass = (state: SummaryResponse["stores"][number]["renewalState"]) => {
  switch (state) {
    case "active":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "renewal_required":
      return "border-rose-400/20 bg-rose-400/10 text-rose-200";
    default:
      return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }
};

const statusLabel = (
  state: SummaryResponse["stores"][number]["renewalState"],
  locale: string
) => {
  if (state === "active") {
    return locale === "en" ? "Active" : "Aktif";
  }
  if (state === "renewal_required") {
    return locale === "en" ? "Renewal required" : "Yenileme gerekli";
  }
  return locale === "en" ? "Activation required" : "Aktivasyon gerekli";
};

export default function HomePanel() {
  const { t, locale } = useI18n();
  const [extensionMarkedDone, setExtensionMarkedDone] = useState(false);

  const syncServerSession = useCallback(async () => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
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

  const fetchSummary = useCallback(async (): Promise<SummaryResponse> => {
    const request = async () =>
      fetch("/api/dashboard/summary", {
        cache: "no-store",
        credentials: "include",
      });

    let response = await request();
    let payload = (await response.json().catch(() => ({}))) as SummaryResponse & { error?: string };

    if (response.status === 401) {
      const synced = await syncServerSession();
      if (synced) {
        response = await request();
        payload = (await response.json().catch(() => ({}))) as SummaryResponse & { error?: string };
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || (locale === "en" ? "Dashboard could not be loaded." : "Dashboard yüklenemedi."));
    }

    return payload;
  }, [locale, syncServerSession]);

  const { data, error, isLoading, isFetching, refetch } = useQuery<SummaryResponse>({
    queryKey: ["dashboard-home-summary"],
    queryFn: fetchSummary,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data?.userId || typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(`${EXTENSION_CHECK_KEY_PREFIX}${data.userId}`) === "1";
    setExtensionMarkedDone(stored);
  }, [data?.userId]);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error instanceof Error ? error.message : locale === "en" ? "Dashboard could not be loaded." : "Dashboard yüklenemedi.");
  }, [error, locale]);

  const handleMarkExtensionDone = () => {
    if (!data?.userId || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(`${EXTENSION_CHECK_KEY_PREFIX}${data.userId}`, "1");
    setExtensionMarkedDone(true);
  };

  const checklist = useMemo<ChecklistItem[]>(() => {
    if (!data) {
      return [];
    }

    return [
      {
        id: "profile",
        title: locale === "en" ? "Complete your profile" : "Profilini tamamla",
        description:
          locale === "en"
            ? "Fill in your name and phone so account, orders, and support flows stay healthy."
            : "Hesap, sipariş ve destek akışı sağlıklı ilerlesin diye ad ve telefon bilgilerini tamamla.",
        done: data.profile.isComplete,
        href: "/settings/profile",
        cta: locale === "en" ? "Open profile" : "Profili aç",
        icon: UserRound,
      },
      {
        id: "store",
        title: locale === "en" ? "Create your first store" : "İlk mağazanı oluştur",
        description:
          locale === "en"
            ? "Open Etsy Automation and connect the store you want to grow first."
            : "Etsy Otomasyon bölümünden büyütmek istediğin ilk mağazayı ekle.",
        done: data.stats.storeCount > 0,
        href: "/etsy-automation",
        cta: locale === "en" ? "Go to stores" : "Mağazalara git",
        icon: Store,
      },
      {
        id: "subscription",
        title: locale === "en" ? "Activate or renew a store" : "Mağazanı aktive et veya yenile",
        description:
          locale === "en"
            ? "At least one active store is required for continuous product generation and uploads."
            : "Sürekli ürün üretimi ve yükleme için en az bir aktif mağaza gerekir.",
        done: data.stats.activeStoreCount > 0 && data.stats.renewalRequiredCount === 0,
        href: "/etsy-automation",
        cta: locale === "en" ? "Review stores" : "Mağazaları incele",
        icon: RefreshCcw,
      },
      {
        id: "extension",
        title: locale === "en" ? "Download the extension" : "Eklentiyi indir",
        description:
          locale === "en"
            ? "Install the Chrome extension so generated listings can be sent to Etsy."
            : "Üretilen listingleri Etsy'ye gönderebilmek için Chrome eklentisini kur.",
        done: extensionMarkedDone,
        href: "/downloads",
        cta: locale === "en" ? "Open downloads" : "İndirme sayfası",
        icon: Download,
      },
      {
        id: "products",
        title: locale === "en" ? "Queue your first product" : "İlk ürününü sıraya al",
        description:
          locale === "en"
            ? "Generated products appear in the Products page and become available for upload."
            : "Üretilen ürünler Ürünler sayfasında görünür ve yüklemeye hazır hale gelir.",
        done: data.stats.totalProductsCount > 0,
        href: "/products",
        cta: locale === "en" ? "Open products" : "Ürünleri aç",
        icon: Boxes,
      },
      {
        id: "orders",
        title: locale === "en" ? "Test the order flow" : "Sipariş akışını test et",
        description:
          locale === "en"
            ? "Create at least one order and verify payment plus shipment flow end to end."
            : "En az bir sipariş oluşturup ödeme ve gönderim akışını uçtan uca doğrula.",
        done: data.stats.totalOrdersCount > 0,
        href: "/orders",
        cta: locale === "en" ? "Open orders" : "Siparişleri aç",
        icon: Package,
      },
    ];
  }, [data, extensionMarkedDone, locale]);

  const completedChecklistCount = checklist.filter((item) => item.done).length;
  const primaryStores = data?.stores.slice(0, 4) ?? [];

  if (isLoading && !data) {
    return <DashboardHomePanelSkeleton />;
  }

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:p-5 lg:p-6">
        <div className="rounded-[28px] border border-rose-400/20 bg-rose-400/10 p-6 text-rose-100">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-black uppercase tracking-widest">
                {locale === "en" ? "Dashboard unavailable" : "Dashboard yüklenemedi"}
              </p>
              <p className="mt-2 text-sm text-rose-100/80">
                {locale === "en"
                  ? "Your summary could not be loaded right now. Retry once the session is healthy again."
                  : "Özet verisi şu anda alınamadı. Oturum yeniden sağlıklı olduğunda tekrar deneyin."}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-rose-200/20 bg-black/20 px-4 py-2 text-xs font-black uppercase tracking-widest text-white"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {t("common.retry")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 pb-8">
        <section className="relative overflow-hidden rounded-[30px] border border-indigo-500/20 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.24),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(20,184,166,0.2),transparent_22%),linear-gradient(180deg,rgba(15,18,33,0.98),rgba(9,11,20,0.98))] p-5 sm:p-7 lg:p-8">
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_45%)]" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                  {locale === "en" ? "Control Center" : "Kontrol Merkezi"}
                </span>
                <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${planBadgeClass(data.plan.plan)}`}>
                  {formatPlanLabel(data.plan.plan, locale)}
                </span>
                {isFetching ? (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {locale === "en" ? "Refreshing" : "Güncelleniyor"}
                  </span>
                ) : null}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300">
                  {locale === "en" ? "Welcome back" : "Tekrar hoş geldin"}{data.profile.fullName ? `, ${data.profile.fullName}` : ""}.
                </p>
                <h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
                  {locale === "en"
                    ? "Run your store from one screen and see what needs attention next."
                    : "Mağazanı tek ekrandan yönet ve sıradaki kritik adımı anında gör."}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  {locale === "en"
                    ? "Track active stores, product queue, orders, renewals, and automation readiness before they break your flow."
                    : "Aktif mağazaları, ürün kuyruğunu, siparişleri, yenilemeleri ve otomasyon sağlığını akış bozulmadan önce takip et."}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px] xl:max-w-[460px]">
              <Link
                href="/etsy-automation"
                className="group rounded-[24px] border border-white/10 bg-white/5 p-4 transition-colors hover:border-indigo-400/30 hover:bg-white/7"
              >
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                  {locale === "en" ? "Store health" : "Mağaza sağlığı"}
                </p>
                <p className="mt-2 text-2xl font-black text-white">{data.stats.activeStoreCount}/{data.stats.storeCount}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {locale === "en" ? "Active stores ready to publish" : "Yayına hazır aktif mağaza"}
                </p>
              </Link>
              <Link
                href="/products"
                className="group rounded-[24px] border border-white/10 bg-white/5 p-4 transition-colors hover:border-teal-400/30 hover:bg-white/7"
              >
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                  {locale === "en" ? "Upload queue" : "Yükleme kuyruğu"}
                </p>
                <p className="mt-2 text-2xl font-black text-white">{data.stats.readyProductsCount}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {locale === "en" ? "Products ready for the extension" : "Eklenti için hazır ürün"}
                </p>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              key: "stores",
              label: locale === "en" ? "Stores" : "Mağazalar",
              value: data.stats.storeCount,
              helper: locale === "en" ? `${data.stats.automationEnabledCount} with automation` : `${data.stats.automationEnabledCount} tanesinde otomasyon bağlı`,
              icon: Store,
            },
            {
              key: "products",
              label: locale === "en" ? "Products" : "Ürünler",
              value: data.stats.totalProductsCount,
              helper: locale === "en" ? `${data.stats.failedProductsCount} failed items` : `${data.stats.failedProductsCount} hatalı ürün`,
              icon: Boxes,
            },
            {
              key: "orders",
              label: locale === "en" ? "Orders" : "Siparişler",
              value: data.stats.totalOrdersCount,
              helper: locale === "en" ? `${data.stats.paidOrdersCount} paid` : `${data.stats.paidOrdersCount} ödemesi alındı`,
              icon: Package,
            },
            {
              key: "renewals",
              label: locale === "en" ? "Attention" : "Dikkat",
              value: data.stats.renewalRequiredCount + data.stats.activationRequiredCount,
              helper:
                locale === "en"
                  ? `${data.stats.renewalRequiredCount} renewals, ${data.stats.activationRequiredCount} activations`
                  : `${data.stats.renewalRequiredCount} yenileme, ${data.stats.activationRequiredCount} aktivasyon`,
              icon: Clock3,
            },
          ].map((card) => (
            <div
              key={card.key}
              className="rounded-[24px] border border-white/10 bg-[#0f1422]/95 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">{card.label}</span>
                <card.icon className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-4 text-3xl font-black tracking-tight text-white">{card.value}</p>
              <p className="mt-2 text-sm text-slate-300">{card.helper}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-white/10 bg-[#0f1422]/95 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                  {locale === "en" ? "Checklist" : "Kontrol listesi"}
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                  {locale === "en" ? "What moves you forward next" : "Seni ileri taşıyacak sonraki adımlar"}
                </h2>
              </div>
              <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-200">
                {completedChecklistCount}/{checklist.length}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  className={`flex flex-col gap-4 rounded-[24px] border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
                    item.done
                      ? "border-emerald-400/20 bg-emerald-400/8"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                        item.done ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-slate-200"
                      }`}
                    >
                      {item.done ? <CircleCheckBig className="h-4.5 w-4.5" /> : <item.icon className="h-4.5 w-4.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{item.description}</p>
                    </div>
                  </div>
                  <Link
                    href={item.href}
                    onClick={() => {
                      if (item.id === "extension") {
                        handleMarkExtensionDone();
                      }
                    }}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:border-indigo-400/30"
                  >
                    {item.cta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-white/10 bg-[#0f1422]/95 p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                {locale === "en" ? "Store health" : "Mağaza durumu"}
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                {locale === "en" ? "Where your stores stand today" : "Mağazalarının bugünkü durumu"}
              </h2>
              <div className="mt-5 space-y-3">
                {primaryStores.length > 0 ? (
                  primaryStores.map((store) => (
                    <div key={store.id} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-white">{store.name}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {store.hasAutomation
                              ? locale === "en"
                                ? "Automation binding is active"
                                : "Otomasyon bağlantısı aktif"
                              : locale === "en"
                                ? "Automation is not connected yet"
                                : "Otomasyon henüz bağlı değil"}
                          </p>
                        </div>
                        <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusToneClass(store.renewalState)}`}>
                          {statusLabel(store.renewalState, locale)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    {locale === "en"
                      ? "No store connected yet. Your first store will appear here."
                      : "Henüz bağlı mağaza yok. İlk mağazan burada görünecek."}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#0f1422]/95 p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                {locale === "en" ? "Quick links" : "Hızlı bağlantılar"}
              </p>
              <div className="mt-5 grid gap-3">
                {[
                  {
                    href: "/categories",
                    title: locale === "en" ? "Review categories" : "Kategorileri incele",
                    desc:
                      locale === "en"
                        ? "Scan what the catalog can produce next."
                        : "Kataloğun sırada ne üretebileceğini tara.",
                    icon: Layers3,
                  },
                  {
                    href: "/downloads",
                    title: locale === "en" ? "Install tools" : "Araçları kur",
                    desc:
                      locale === "en"
                        ? "Open the extension and mobile download center."
                        : "Eklenti ve mobil indirme merkezini aç.",
                    icon: Download,
                  },
                  {
                    href: "/referral",
                    title: locale === "en" ? "Grow via referral" : "Referral ile büyü",
                    desc:
                      locale === "en"
                        ? "Use your invite flow to unlock credits and cash rewards."
                        : "Davet akışını kullanarak kredi ve nakit ödül aç.",
                    icon: Sparkles,
                  },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group rounded-[22px] border border-white/10 bg-white/5 p-4 transition-colors hover:border-indigo-400/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 text-slate-200">
                          <item.icon className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-400">{item.desc}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
