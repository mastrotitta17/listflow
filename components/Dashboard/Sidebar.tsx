"use client";


import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store';
import { DashboardSection, View } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { useI18n } from '@/lib/i18n/provider';
import { useRouter } from 'next/navigation';
import {
  Gift,
  Globe2,
  Layers,
  LogOut,
  Package,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';

type SidebarProps = {
  activeSection?: DashboardSection;
  mobileOpen?: boolean;
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
      <div className="relative rounded-2xl overflow-hidden border border-indigo-500/25 bg-linear-to-br from-indigo-900/35 via-[#0d111b] to-cyan-900/15 px-4 py-3.5 transition-all duration-300 hover:border-indigo-500/50 hover:shadow-[0_8px_32px_rgba(99,102,241,0.25)]">
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

const Sidebar: React.FC<SidebarProps> = ({ activeSection, mobileOpen = false, onClose }) => {
  const { dashboardSection, setDashboardSection, setView } = useStore();
  const { t } = useI18n();
  const router = useRouter();
  const effectiveSection = activeSection ?? dashboardSection;

  const resolveSectionPath = (section: DashboardSection) => {
    switch (section) {
      case DashboardSection.CATEGORIES:
        return "/categories";
      case DashboardSection.ETSY_AUTOMATION:
        return "/etsy-automation";
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
      "/categories",
      "/etsy-automation",
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

  const menuItems = [
    { id: DashboardSection.CATEGORIES, label: t("sidebar.categories"), icon: Layers },
    { id: DashboardSection.ETSY_AUTOMATION, label: t("sidebar.etsyAutomation"), icon: Store },
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
        className={`fixed inset-y-0 left-0 z-40 w-59 px-3 h-full flex flex-col sidebar-bg shrink-0 transform transition-transform duration-300 lg:relative lg:z-20 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      {/* Brand Logo Section */}
      <div
        className="flex items-center gap-4 px-2 py-6 mb-5 group cursor-pointer"
        onClick={() => {
          onClose?.();
          setView(View.LANDING);
          router.push("/");
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

      <nav className="flex-1 space-y-2">
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
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-[18px] transition-all duration-300 relative group cursor-pointer group/coming ${
                isActive
                  ? 'bg-indigo-600/15 border border-indigo-500/40 text-white'
                  : 'hover:bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              <item.icon className={`w-4.5 h-4.5 transition-transform ${isActive ? 'scale-110 text-indigo-400' : 'group-hover:scale-110'}`} />
              <span className="font-bold text-[14px] tracking-tight">{item.label}</span>
              {item.comingSoon && (
                <span className="ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-900 absolute -right-6 group-hover/coming:opacity-100 opacity-0 transition-all duration-300 z-50">
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

      {/* Footer Section */}
      <div className="mt-auto space-y-2 pt-6 border-t border-indigo-500/10">
        {/* ── Referral Card ── */}
        <ReferralCard
          onClick={() => {
            setDashboardSection(DashboardSection.REFERRAL);
            router.push("/referral");
            onClose?.();
          }}
        />

        <button
          onClick={() => {
            setDashboardSection(DashboardSection.SETTINGS);
            router.push(resolveSectionPath(DashboardSection.SETTINGS));
            onClose?.();
          }}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-[18px] transition-all cursor-pointer ${
            effectiveSection === DashboardSection.SETTINGS
              ? 'bg-indigo-600/15 border border-indigo-500/40 text-white'
              : 'hover:bg-white/5 text-slate-500 hover:text-white font-bold'
          }`}
        >
          <Settings className="w-4.5 h-4.5" />
          <span className="font-bold text-[14px]">{t("sidebar.settings")}</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-4 px-5 py-4 mb-6 rounded-[18px] hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all group font-bold cursor-pointer"
        >
          <LogOut className="w-4.5 h-4.5 group-hover:-translate-x-1 transition-transform" />
          <span className="text-[14px]">{t("sidebar.logout")}</span>
        </button>
      </div>
      </div>
    </>
  );
};

export default Sidebar;
