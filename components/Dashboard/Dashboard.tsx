"use client";


import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import CategoriesPanel from './CategoriesPanel';
import EtsyPanel from './EtsyPanel';
import OrdersPanel from './OrdersPanel';
import SettingsPanel from './SettingsPanel';
import { useStore } from '../../store';
import { DashboardSection } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { Menu, User } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

type SubscriptionSummary = {
  plan: string | null;
  status: string | null;
};

type ProfileSummary = {
  full_name?: string | null;
};

const PLAN_PRIORITY = ["turbo", "pro", "standard"] as const;
const TOUR_STORAGE_KEY_PREFIX = "listflow:dashboard-tour:v1:";
const TOUR_SIDE_PATTERN: Array<"left" | "right"> = ["left", "right", "left", "right", "left"];

type DashboardProps = {
  routeSection?: DashboardSection;
  routeCategorySlug?: string | null;
  disableTour?: boolean;
};

const Dashboard: React.FC<DashboardProps> = ({
  routeSection,
  routeCategorySlug = null,
  disableTour = false,
}) => {
  const { dashboardSection, setDashboardSection } = useStore();
  const { t } = useI18n();
  const [userName, setUserName] = useState<string>('...');
  const [planLabel, setPlanLabel] = useState<string>(t("dashboard.planLoading"));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourUserId, setTourUserId] = useState<string | null>(null);
  const activeSection = routeSection ?? dashboardSection;

  const tourSteps = useMemo(
    () => [
      {
        section: DashboardSection.CATEGORIES,
        title: t("dashboard.tourStepWelcomeTitle"),
        description: t("dashboard.tourStepWelcomeDescription"),
      },
      {
        section: DashboardSection.CATEGORIES,
        title: t("dashboard.tourStepCategoriesTitle"),
        description: t("dashboard.tourStepCategoriesDescription"),
      },
      {
        section: DashboardSection.ETSY_AUTOMATION,
        title: t("dashboard.tourStepEtsyTitle"),
        description: t("dashboard.tourStepEtsyDescription"),
      },
      {
        section: DashboardSection.ORDERS,
        title: t("dashboard.tourStepOrdersTitle"),
        description: t("dashboard.tourStepOrdersDescription"),
      },
      {
        section: DashboardSection.SETTINGS,
        title: t("dashboard.tourStepSettingsTitle"),
        description: t("dashboard.tourStepSettingsDescription"),
      },
    ],
    [t]
  );

  const shouldShowTourForUser = useCallback((user: { id: string; user_metadata?: unknown }) => {
      try {
        const localTourKey = `${TOUR_STORAGE_KEY_PREFIX}${user.id}`;
        const localTourCompleted =
          typeof window !== "undefined" && window.localStorage.getItem(localTourKey) === "1";

        return !localTourCompleted;
      } catch {
        // If storage is unavailable, still show tour once in session.
        return true;
      }
    }, []);

  const resolvePlanLabel = useCallback((plan: string | null | undefined, status: string | null | undefined) => {
      const normalizedPlan = (plan ?? "").toLowerCase();
      const normalizedStatus = (status ?? "").toLowerCase();

      let label = t("dashboard.planFree");
      if (normalizedPlan === "standard") label = t("dashboard.planStandard");
      if (normalizedPlan === "pro") label = t("dashboard.planPro");
      if (normalizedPlan === "turbo") label = t("dashboard.planTurbo");

      if (normalizedStatus === "trialing") {
        return `${label} (${t("dashboard.planTrialSuffix")})`;
      }

      return label;
    }, [t]);

  const fetchUser = useCallback(async (mountedRef: { value: boolean }) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setTourUserId(user.id);

          if (mountedRef.value && !disableTour && !routeSection && shouldShowTourForUser(user)) {
            setDashboardSection(DashboardSection.CATEGORIES);
            setTourStepIndex(0);
            setTourVisible(true);
          }

          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("user_id", user.id)
              .maybeSingle<ProfileSummary>();

            // Önce profiles.full_name, sonra metadata, sonra email fallback.
            const fullNameFromProfile = profile?.full_name?.trim();
            const fullNameFromMetadata =
              (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
              (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "");
            const emailPrefix = user.email?.split('@')[0];
            if (mountedRef.value) {
              setUserName(fullNameFromProfile || fullNameFromMetadata || emailPrefix || t("dashboard.userFallback"));
            }
          } catch {
            const fallbackName =
              (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
              (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "") ||
              user.email?.split("@")[0] ||
              t("dashboard.userFallback");

            if (mountedRef.value) {
              setUserName(fallbackName);
            }
          }

          try {
            let selectedSubscription: SubscriptionSummary | null = null;

            for (const plan of PLAN_PRIORITY) {
              const { data } = await supabase
                .from("subscriptions")
                .select("plan, status")
                .eq("user_id", user.id)
                .eq("plan", plan)
                .in("status", ["active", "trialing"])
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle<SubscriptionSummary>();

              if (data) {
                selectedSubscription = data;
                break;
              }
            }

            if (mountedRef.value) {
              setPlanLabel(resolvePlanLabel(selectedSubscription?.plan, selectedSubscription?.status));
            }
          } catch {
            if (mountedRef.value) {
              setPlanLabel(t("dashboard.planUnknown"));
            }
          }

          return;
        }

        if (mountedRef.value) {
          setUserName(t("dashboard.userFallback"));
          setPlanLabel(t("dashboard.planUnknown"));
        }
      } catch {
        if (mountedRef.value) {
          setUserName(t("dashboard.userFallback"));
          setPlanLabel(t("dashboard.planUnknown"));
        }
      }
    }, [disableTour, resolvePlanLabel, routeSection, setDashboardSection, shouldShowTourForUser, t]);

  useEffect(() => {
    const mountedRef = { value: true };
    const bootstrapTimer = setTimeout(() => {
      void fetchUser(mountedRef);
    }, 0);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void fetchUser(mountedRef);
    });

    return () => {
      clearTimeout(bootstrapTimer);
      mountedRef.value = false;
      subscription.unsubscribe();
    };
  }, [fetchUser]);

  useEffect(() => {
    if (!routeSection) {
      return;
    }

    if (dashboardSection !== routeSection) {
      setDashboardSection(routeSection);
    }
  }, [dashboardSection, routeSection, setDashboardSection]);

  useEffect(() => {
    if (!tourVisible || disableTour || routeSection) {
      return;
    }

    const step = tourSteps[tourStepIndex];
    if (step?.section && step.section !== dashboardSection) {
      setDashboardSection(step.section);
    }
  }, [dashboardSection, disableTour, routeSection, setDashboardSection, tourStepIndex, tourSteps, tourVisible]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    type CrispWindow = Window & { $crisp?: unknown[][] };
    const crispWindow = window as CrispWindow;
    if (!Array.isArray(crispWindow.$crisp)) {
      crispWindow.$crisp = [];
    }

    crispWindow.$crisp.push(["do", tourVisible ? "chat:hide" : "chat:show"]);
  }, [tourVisible]);

  const markTourCompleted = async () => {
    setTourVisible(false);

    if (tourUserId && typeof window !== "undefined") {
      window.localStorage.setItem(`${TOUR_STORAGE_KEY_PREFIX}${tourUserId}`, "1");
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const metadata =
        typeof user.user_metadata === "object" && user.user_metadata !== null
          ? (user.user_metadata as Record<string, unknown>)
          : {};

      await supabase.auth.updateUser({
        data: {
          ...metadata,
          dashboard_tour_completed: true,
        },
      });
    } catch {
      // no-op: local storage fallback already persisted.
    }
  };

  const handleTourNext = () => {
    if (tourStepIndex >= tourSteps.length - 1) {
      void markTourCompleted();
      return;
    }

    setTourStepIndex((prev) => Math.min(prev + 1, tourSteps.length - 1));
  };

  const handleTourBack = () => {
    setTourStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const renderContent = () => {
    switch (activeSection) {
      case DashboardSection.CATEGORIES: return <CategoriesPanel routeCategorySlug={routeCategorySlug} />;
      case DashboardSection.ETSY_AUTOMATION: return <EtsyPanel />;
      case DashboardSection.PINTEREST_AUTOMATION:
      case DashboardSection.META_AUTOMATION:
      case DashboardSection.EBAY_AUTOMATION:
      case DashboardSection.AMAZON_AUTOMATION:
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div className="glass-card-pro border border-white/10 rounded-[32px] p-10 max-w-xl w-full text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-3">
                {t("dashboard.sections." + activeSection)}
              </p>
              <p className="text-slate-300 font-semibold">{t("common.comingSoon")}</p>
            </div>
          </div>
        );
      case DashboardSection.ORDERS: return <OrdersPanel />;
      case DashboardSection.SETTINGS: return <SettingsPanel />;
      default: return null;
    }
  };

  const tourSide = TOUR_SIDE_PATTERN[tourStepIndex] ?? "left";
  const isTourLeft = tourSide === "left";
  const tourPositionClasses = isTourLeft
    ? "left-3 sm:left-6 lg:left-6"
    : "right-3 sm:right-6 lg:right-8";
  const pointerClasses = isTourLeft
    ? "left-8 border-l border-t border-indigo-400/30 bg-[#13192a]"
    : "right-8 border-r border-t border-indigo-400/30 bg-[#13192a]";

  return (
    <>
    <div className="flex h-screen overflow-hidden bg-[#0a0a0c]">
      <Sidebar
        activeSection={activeSection}
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 px-4 sm:px-6 lg:px-10 flex items-center justify-between glass-pro border-b border-indigo-500/10 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 lg:hidden cursor-pointer"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="text-sm sm:text-base lg:text-xl font-black tracking-tight text-white uppercase">
              {t(`dashboard.sections.${activeSection}`)}
            </h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 pl-2 group">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white leading-none mb-1">{userName}</p>
                <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                  {`${t("dashboard.planPrefix")}: ${planLabel}`}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-indigo-500/20 overflow-hidden">
                <User className="text-white w-6 h-6" />
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>

    <AnimatePresence>
      {tourVisible ? (
        <div className="fixed inset-0 z-[2147483647] pointer-events-none">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
          <motion.div
            key={`tour-step-${tourStepIndex}-${tourSide}`}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{
              opacity: 1,
              y: [0, -6, 0],
              scale: 1,
            }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{
              opacity: { duration: 0.2 },
              scale: { duration: 0.2 },
              y: { duration: 4.8, repeat: Infinity, ease: "easeInOut" },
            }}
            className={`pointer-events-auto absolute top-24 lg:top-28 ${tourPositionClasses} w-[min(92vw,420px)] rounded-3xl border border-indigo-400/30 bg-[#0e1424]/95 p-5 shadow-[0_24px_80px_rgba(4,10,28,0.8)]`}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
              <div className="absolute -top-16 -left-10 h-36 w-36 rounded-full bg-indigo-500/20 blur-2xl" />
              <div className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-cyan-500/15 blur-2xl" />
            </div>
            <div className={`pointer-events-none absolute -top-2 h-4 w-4 rotate-45 ${pointerClasses}`} />

            <div className="relative">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-2">{t("dashboard.tourTitle")}</p>
              <h3 className="text-lg font-black text-white mb-2">{tourSteps[tourStepIndex]?.title}</h3>
              <p className="text-sm text-slate-300 leading-relaxed mb-4">{tourSteps[tourStepIndex]?.description}</p>

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">
                {t("dashboard.tourProgressLabel")} {tourStepIndex + 1}/{tourSteps.length}
              </p>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void markTourCompleted()}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-white transition-all cursor-pointer"
                >
                  {t("dashboard.tourSkip")}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTourBack}
                    disabled={tourStepIndex === 0}
                    className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-white transition-all disabled:opacity-40 cursor-pointer"
                  >
                    {t("dashboard.tourBack")}
                  </button>
                  <button
                    type="button"
                    onClick={handleTourNext}
                    className="rounded-xl bg-indigo-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-500 transition-all cursor-pointer"
                  >
                    {tourStepIndex === tourSteps.length - 1 ? t("dashboard.tourFinish") : t("dashboard.tourNext")}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
    </>
  );
};

export default Dashboard;
