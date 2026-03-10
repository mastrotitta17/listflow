"use client";


import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store';
import { DashboardSection, View } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { useI18n } from '@/lib/i18n/provider';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  Gift,
  CreditCard,
  ChevronUp,
  Globe2,
  House,
  Layers,
  LogOut,
  Mail,
  Package,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  UserRound,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';

type SidebarProps = {
  activeSection?: DashboardSection;
  mobileOpen?: boolean;
  expiredStoreCount?: number;
  onClose?: () => void;
};

// ── Mini referral card shown above the Settings button ────────────────────────
const ReferralCard: React.FC<{
  onClick: () => void;
}> = ({ onClick }) => {
  const { t } = useI18n();
  const [qualified, setQualified] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/referral");
        if (!res.ok) return;
        const data = (await res.json()) as { stats?: { qualifiedCount?: number } };
        setQualified(data.stats?.qualifiedCount ?? 0);
      } catch {
        // silent
      }
    };
    void load();
  }, []);

  const progress5 = Math.min((qualified ?? 0) / 5, 1);
  const milestone5Done = (qualified ?? 0) >= 5;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer group"
    >
      <div className="relative rounded-2xl overflow-hidden border border-indigo-500/25 bg-linear-to-br from-indigo-900/35 via-[#0d111b] to-cyan-900/15 px-4 py-3.5 [@media(max-height:840px)]:px-3 [@media(max-height:840px)]:py-2.5 transition-all duration-300 hover:border-indigo-500/50 hover:shadow-[0_8px_32px_rgba(99,102,241,0.25)]">
        {/* Glow blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-4 -right-4 h-16 w-16 rounded-full bg-indigo-500/20 blur-xl group-hover:bg-indigo-500/30 transition-all" />
          <div className="absolute -bottom-4 -left-4 h-12 w-12 rounded-full bg-cyan-500/10 blur-xl" />
        </div>

        {/* Content */}
        <div className="relative flex items-center gap-3">
          {/* Icon */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600/25 border border-indigo-500/30 group-hover:scale-110 transition-transform">
            <Gift className="h-4 w-4 text-indigo-300" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-black tracking-tight text-white leading-none">
                {t("sidebar.referralCardTitle")}
              </p>
              {/* Floating sparkle */}
              <motion.div
                animate={{ rotate: [0, 20, -20, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              >
                <Sparkles className="h-3 w-3 text-amber-400" />
              </motion.div>
            </div>
            <p className="text-[9px] text-slate-500 font-bold mt-0.5 leading-none">
              {milestone5Done
                ? t("sidebar.referralCardUnlocked")
                : `${qualified ?? "…"}/5 ${t("sidebar.referralCardFriendsSuffix")}`}
            </p>
          </div>

          {/* Users icon */}
          <Users className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
        </div>

        {/* Progress bar */}
        <div className="relative mt-3 h-1.5 w-full rounded-full bg-white/5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress5 * 100}%` }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
            className={`h-full rounded-full ${milestone5Done ? "bg-linear-to-r from-indigo-500 to-cyan-400" : "bg-indigo-600"}`}
          />
          {/* Stars on progress bar */}
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${(n / 5) * 100 - 2}%` }}
            >
              <Star
                className={`h-2.5 w-2.5 ${
                  (qualified ?? 0) >= n ? "text-indigo-300 fill-indigo-300" : "text-slate-700"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Rewards badge row */}
        <div className="relative mt-2.5 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-indigo-600/15 border border-indigo-500/20 px-2 py-0.5">
            <Zap className="h-2.5 w-2.5 text-indigo-400" />
            <span className="text-[9px] font-black text-indigo-300">{t("sidebar.referralCardDiscount")}</span>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-amber-600/15 border border-amber-500/20 px-2 py-0.5">
            <span className="text-[9px] font-black text-amber-300">{t("sidebar.referralCardCash")}</span>
          </div>
        </div>
      </div>
    </button>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  mobileOpen = false,
  expiredStoreCount = 0,
  onClose,
}) => {
  const { dashboardSection, setDashboardSection, setView } = useStore();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const effectiveSection = activeSection ?? dashboardSection;
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<{
    fullName: string;
    email: string;
    avatarUrl: string | null;
  }>({
    fullName: t("dashboard.userFallback"),
    email: "",
    avatarUrl: null,
  });
  const accountPanelRef = useRef<HTMLDivElement | null>(null);

  const resolveSectionPath = (section: DashboardSection) => {
    switch (section) {
      case DashboardSection.HOME:
        return "/dashboard";
      case DashboardSection.CATEGORIES:
        return "/categories";
      case DashboardSection.ETSY_AUTOMATION:
        return "/etsy-automation";
      case DashboardSection.PRODUCTS:
        return "/products";
      case DashboardSection.PINTEREST_AUTOMATION:
        return "/pinterest-automation";
      case DashboardSection.META_AUTOMATION:
        return "/meta-automation";
      case DashboardSection.EBAY_AUTOMATION:
        return "/ebay-automation";
      case DashboardSection.AMAZON_AUTOMATION:
        return "/amazon-automation";
      case DashboardSection.ORDERS:
        return "/orders";
      case DashboardSection.SETTINGS:
        return "/settings/profile";
      case DashboardSection.REFERRAL:
        return "/referral";
      default:
        return "/";
    }
  };

  useEffect(() => {
    const staticPaths = [
      "/dashboard",
      "/categories",
      "/etsy-automation",
      "/products",
      "/pinterest-automation",
      "/meta-automation",
      "/ebay-automation",
      "/amazon-automation",
      "/orders",
      "/settings",
      "/settings/profile",
      "/settings/subscription",
      "/settings/security",
      "/settings/account",
      "/referral",
    ];

    for (const path of staticPaths) {
      router.prefetch(path);
    }

  }, [router]);

  useEffect(() => {
    let mounted = true;

    const loadAccountProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!mounted || !user) {
          return;
        }

        let fullName =
          (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
          (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "") ||
          user.email?.split("@")[0] ||
          t("dashboard.userFallback");

        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, avatar_url")
            .eq("user_id", user.id)
            .maybeSingle<{ full_name?: string | null; avatar_url?: string | null }>();

          if (profile?.full_name?.trim()) {
            fullName = profile.full_name.trim();
          }

          const profileAvatar =
            typeof profile?.avatar_url === "string" && profile.avatar_url.trim() ? profile.avatar_url.trim() : null;

          setAccountProfile({
            fullName,
            email: user.email ?? "",
            avatarUrl:
              profileAvatar ??
              (typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url.trim()
                ? user.user_metadata.avatar_url.trim()
                : null),
          });
          return;
        } catch {
          // keep metadata fallback
        }

        setAccountProfile({
          fullName,
          email: user.email ?? "",
          avatarUrl:
            typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url.trim()
              ? user.user_metadata.avatar_url.trim()
              : null,
        });
      } catch {
        // keep fallback state
      }
    };

    void loadAccountProfile();

    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!accountPanelRef.current) {
        return;
      }

      if (!accountPanelRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [accountMenuOpen]);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    await fetch("/api/auth/session", { method: "DELETE" });
    if (error) {
      console.error("Çıkış yapılırken hata:", error.message);
    }
    onClose?.();
    setView(View.LANDING);
    router.push("/login");
  };

  const accountInitials = useMemo(() => {
    const source = accountProfile.fullName.trim();
    if (!source) {
      return "LF";
    }

    const parts = source
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2);

    return parts.map((part) => part.charAt(0).toUpperCase()).join("") || source.slice(0, 2).toUpperCase();
  }, [accountProfile.fullName]);

  const openSettingsSection = (section: DashboardSection, path: string) => {
    setDashboardSection(section);
    setAccountMenuOpen(false);
    router.push(path);
    onClose?.();
  };

  const menuItems = [
    { id: DashboardSection.HOME, label: t("sidebar.home"), icon: House },
    { id: DashboardSection.CATEGORIES, label: t("sidebar.categories"), icon: Layers },
    { id: DashboardSection.ETSY_AUTOMATION, label: t("sidebar.etsyAutomation"), icon: Store },
    { id: DashboardSection.PRODUCTS, label: t("sidebar.products"), icon: Boxes },
    { id: DashboardSection.PINTEREST_AUTOMATION, label: t("sidebar.pinterestAutomation"), icon: Sparkles, comingSoon: true },
    { id: DashboardSection.META_AUTOMATION, label: t("sidebar.metaAutomation"), icon: Globe2, comingSoon: true },
    { id: DashboardSection.EBAY_AUTOMATION, label: t("sidebar.ebayAutomation"), icon: Workflow, comingSoon: true },
    { id: DashboardSection.AMAZON_AUTOMATION, label: t("sidebar.amazonAutomation"), icon: ShieldCheck, comingSoon: true },
    { id: DashboardSection.ORDERS, label: t("sidebar.orders"), icon: Package },
  ];

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 h-[100dvh] px-3 flex flex-col overflow-x-hidden overflow-y-hidden sidebar-bg shrink-0 transform transition-transform duration-300 lg:relative lg:z-20 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      {/* Brand Logo Section */}
      <div
        className="shrink-0 flex items-center gap-4 px-2 py-6 mb-4 [@media(max-height:840px)]:py-4 [@media(max-height:840px)]:mb-3 group cursor-pointer"
        onClick={() => {
          onClose?.();
          setView(View.DASHBOARD);
          setDashboardSection(DashboardSection.HOME);
          router.push("/dashboard");
        }}
      >
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:rotate-6 transition-all border border-indigo-400/30">
          <Rocket className="text-white w-5 h-5" />
        </div>
        <div>
          <span className="text-lg font-black tracking-tight text-white block leading-none">listflow<span className="text-indigo-400">.pro</span></span>
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1.5 block">{t("sidebar.premiumSuite")}</span>
        </div>
      </div>

      <div className="min-h-0 flex flex-1 flex-col overflow-x-hidden">
        <div className="min-h-0 flex-1 overflow-x-hidden pr-1">
        <nav className="space-y-1.5 [@media(max-height:840px)]:space-y-1">
          {menuItems.map((item) => {
            const isActive = effectiveSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setDashboardSection(item.id);
                  router.push(resolveSectionPath(item.id));
                  onClose?.();
                }}
                className={`w-full flex items-center gap-4 px-5 py-3.5 [@media(max-height:840px)]:py-3 [@media(max-height:760px)]:py-2.5 rounded-[18px] transition-all duration-300 relative group cursor-pointer group/coming ${
                  isActive
                    ? 'bg-indigo-600/15 border border-indigo-500/40 text-white'
                    : 'hover:bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                <item.icon className={`w-4.5 h-4.5 transition-transform ${isActive ? 'scale-110 text-indigo-400' : 'group-hover:scale-110'}`} />
                <span className="font-bold text-[14px] tracking-tight">{item.label}</span>
                {item.id === DashboardSection.ETSY_AUTOMATION && expiredStoreCount > 0 ? (
                  <span
                    className="ml-auto inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.7)]"
                    title={t("sidebar.subscriptionRenewalRequired")}
                    aria-label={t("sidebar.subscriptionRenewalRequired")}
                  />
                ) : null}
                {item.comingSoon && (
                  <span className="ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-900 absolute right-3 top-1/2 -translate-y-1/2 group-hover/coming:opacity-100 opacity-0 transition-all duration-300 z-50">
                    {t("common.comingSoon")}
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="activeSideIndicator"
                    className="absolute right-0 w-1 h-5 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-3 pt-3 border-t border-indigo-500/10 [@media(max-height:840px)]:mt-2.5 [@media(max-height:840px)]:pt-2.5 [@media(max-height:760px)]:mt-2 [@media(max-height:760px)]:pt-2">
          {/* ── Referral Card ── */}
          <ReferralCard
            onClick={() => {
              setDashboardSection(DashboardSection.REFERRAL);
              router.push("/referral");
              onClose?.();
            }}
          />
        </div>
        </div>

        <div
          ref={accountPanelRef}
          className="relative shrink-0 mt-3 pt-3 pb-4 border-t border-indigo-500/10 [@media(max-height:840px)]:mt-2.5 [@media(max-height:840px)]:pt-2.5 [@media(max-height:840px)]:pb-3 [@media(max-height:760px)]:mt-2 [@media(max-height:760px)]:pt-2 [@media(max-height:760px)]:pb-2"
        >
          <AnimatePresence>
            {accountMenuOpen ? (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute inset-x-0 bottom-full mb-3 overflow-hidden rounded-[22px] border border-white/10 bg-[#0d1322]/96 p-3 shadow-[0_22px_60px_rgba(2,6,23,0.75)] backdrop-blur-xl z-[9999]"
              >
                <div className="mb-3 rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    {locale === "en" ? "Account Controls" : "Hesap Kontrolleri"}
                  </p>
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => openSettingsSection(DashboardSection.SETTINGS, "/settings/profile")}
                      className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-white/[0.03] px-3 py-2.5 text-left text-sm font-bold text-slate-200 transition-all hover:border-white/10 hover:bg-white/[0.06] cursor-pointer"
                    >
                      <UserRound className="h-4 w-4 text-indigo-300" />
                      <span>{t("settings.profileTitle")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openSettingsSection(DashboardSection.SETTINGS, "/settings/subscription")}
                      className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-white/[0.03] px-3 py-2.5 text-left text-sm font-bold text-slate-200 transition-all hover:border-white/10 hover:bg-white/[0.06] cursor-pointer"
                    >
                      <CreditCard className="h-4 w-4 text-emerald-300" />
                      <span>{t("settings.subscriptionTitle")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openSettingsSection(DashboardSection.SETTINGS, "/settings/security")}
                      className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-white/[0.03] px-3 py-2.5 text-left text-sm font-bold text-slate-200 transition-all hover:border-white/10 hover:bg-white/[0.06] cursor-pointer"
                    >
                      <ShieldCheck className="h-4 w-4 text-cyan-300" />
                      <span>{t("settings.securityTitle")}</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    {locale === "en" ? "Language" : "Dil"}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setLocale("tr")}
                      className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] transition-all cursor-pointer ${
                        locale === "tr"
                          ? "border-indigo-500/40 bg-indigo-600 text-white"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:text-white"
                      }`}
                    >
                      TR
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocale("en")}
                      className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] transition-all cursor-pointer ${
                        locale === "en"
                          ? "border-indigo-500/40 bg-indigo-600 text-white"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:text-white"
                      }`}
                    >
                      EN
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-red-100 transition-all hover:bg-red-500/15 cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{t("sidebar.logout")}</span>
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => setAccountMenuOpen((current) => !current)}
            className="group flex w-full items-center gap-3 rounded-[22px] border border-white/10 bg-linear-to-br from-[#0f1728] via-[#11192d] to-[#0b1324] px-3 py-3.5 text-left shadow-[0_12px_40px_rgba(2,6,23,0.35)] transition-all hover:border-indigo-400/30 hover:shadow-[0_18px_48px_rgba(79,70,229,0.2)] cursor-pointer"
          >
            {accountProfile.avatarUrl ? (
              <img
                src={accountProfile.avatarUrl}
                alt={accountProfile.fullName}
                className="h-11 w-11 shrink-0 rounded-full border border-white/10 object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-indigo-400/25 bg-indigo-500/15 text-sm font-black text-indigo-100">
                {accountInitials}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black tracking-tight text-white">{accountProfile.fullName}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="truncate">{accountProfile.email || "—"}</span>
              </div>
            </div>

            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition-all group-hover:border-indigo-400/30 group-hover:text-white">
              <ChevronUp className={`h-4 w-4 transition-transform ${accountMenuOpen ? "rotate-0" : "rotate-180"}`} />
            </div>
          </button>
        </div>
      </div>
      </div>
    </>
  );
};

export default Sidebar;
