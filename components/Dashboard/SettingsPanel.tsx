"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CreditCard,
  KeyRound,
  Loader2,
  QrCode,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "sonner";

type ProfilePayload = {
  userId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  role: string | null;
  createdAt: string | null;
};

type SubscriptionPayload = {
  id: string;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  isActive: boolean;
};

type SubscriptionInvoicePayload = {
  id: string;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;
  amountCents: number;
  currency: string | null;
  status: string | null;
  createdAt: string | null;
};

type SubscriptionMonthPayload = {
  monthKey: string;
  totalAmountCents: number;
  currency: string | null;
  invoices: SubscriptionInvoicePayload[];
};

type SettingsResponse = {
  profile?: ProfilePayload;
  subscriptions?: SubscriptionPayload[];
  subscriptionMonths?: SubscriptionMonthPayload[];
  hasActiveSubscription?: boolean;
  error?: string;
};

type ProfileUpdateResponse = {
  profile?: ProfilePayload;
  success?: boolean;
  error?: string;
};

type SubscriptionPortalResponse = {
  url?: string;
  error?: string;
};

type DeleteAccountResponse = {
  success?: boolean;
  error?: string;
};

type SettingsSectionKey = "profile" | "subscription" | "security" | "account";

type TotpEnrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
  verificationCode: string;
};

type MfaFactor = {
  id: string;
  factor_type: string;
  status: string;
};

const resolveSettingsSection = (pathname: string | null): SettingsSectionKey => {
  if (!pathname) {
    return "profile";
  }

  if (pathname.startsWith("/settings/subscription")) {
    return "subscription";
  }

  if (pathname.startsWith("/settings/security")) {
    return "security";
  }

  if (pathname.startsWith("/settings/account")) {
    return "account";
  }

  return "profile";
};

const SettingsPanel: React.FC = () => {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const isEn = locale === "en";

  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [profileMeta, setProfileMeta] = useState<{
    userId: string | null;
    role: string | null;
    createdAt: string | null;
  }>({
    userId: null,
    role: null,
    createdAt: null,
  });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subscriptions, setSubscriptions] = useState<SubscriptionPayload[]>([]);
  const [subscriptionMonths, setSubscriptionMonths] = useState<SubscriptionMonthPayload[]>([]);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isOpeningSubscriptionPortal, setIsOpeningSubscriptionPortal] = useState(false);
  const [isOpeningUpgradePortal, setIsOpeningUpgradePortal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaVerifiedFactorId, setMfaVerifiedFactorId] = useState<string | null>(null);
  const [mfaHasVerifiedTotp, setMfaHasVerifiedTotp] = useState(false);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [isStartingTotpSetup, setIsStartingTotpSetup] = useState(false);
  const [isVerifyingTotpSetup, setIsVerifyingTotpSetup] = useState(false);
  const [disableTotpCode, setDisableTotpCode] = useState("");
  const [isDisablingTotp, setIsDisablingTotp] = useState(false);

  useEffect(() => {
    if (!loadingError) {
      return;
    }

    toast.error(loadingError);
  }, [loadingError]);

  useEffect(() => {
    if (!infoMessage) {
      return;
    }

    const normalized = infoMessage.toLowerCase();
    const looksLikeError =
      normalized.includes("hata") ||
      normalized.includes("başarısız") ||
      normalized.includes("failed") ||
      normalized.includes("could not") ||
      normalized.includes("yüklenemedi") ||
      normalized.includes("açılamadı") ||
      normalized.includes("silinemedi") ||
      normalized.includes("güncellenemedi") ||
      normalized.includes("durdurulamadı");

    if (looksLikeError) {
      toast.error(infoMessage);
      return;
    }

    toast.success(infoMessage);
  }, [infoMessage]);

  const planLabel = useCallback(
    (plan: string | null | undefined) => {
      const normalized = (plan ?? "").toLowerCase();
      if (normalized === "standard") return t("dashboard.planStandard");
      if (normalized === "pro") return t("dashboard.planPro");
      if (normalized === "turbo") return t("dashboard.planTurbo");
      return t("settings.planUnknown");
    },
    [t]
  );

  const statusLabel = useCallback(
    (status: string | null | undefined) => {
      const normalized = (status ?? "").toLowerCase();

      if (normalized === "active") return t("settings.statusActive");
      if (normalized === "trialing") return t("settings.statusTrialing");
      if (normalized === "canceled") return t("settings.statusCanceled");
      if (normalized === "past_due") return t("settings.statusPastDue");
      if (normalized === "incomplete") return t("settings.statusIncomplete");
      if (normalized === "incomplete_expired") return t("settings.statusIncompleteExpired");
      if (normalized === "unpaid") return t("settings.statusUnpaid");

      return status ?? t("settings.statusUnknown");
    },
    [t]
  );

  const formatDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) {
        return t("settings.notAvailable");
      }

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return t("settings.notAvailable");
      }

      return parsed.toLocaleDateString(locale === "en" ? "en-US" : "tr-TR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    },
    [locale, t]
  );

  const formatMoneyFromCents = useCallback(
    (amountCents: number, currency: string | null | undefined) => {
      const normalizedCurrency = (currency ?? "usd").toUpperCase();
      const currencyCode = normalizedCurrency === "TRY" ? "TRY" : "USD";

      return new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountCents / 100);
    },
    [locale]
  );

  const refreshMfaState = useCallback(async () => {
    setMfaLoading(true);

    try {
      const [factorsResponse, aalResponse] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      if (factorsResponse.error) {
        throw factorsResponse.error;
      }

      if (aalResponse.error) {
        throw aalResponse.error;
      }

      const factors = ((factorsResponse.data?.all ?? []) as MfaFactor[]).filter(
        (factor) => factor.factor_type === "totp"
      );

      const verifiedFactor = factors.find((factor) => factor.status === "verified") ?? null;

      setMfaVerifiedFactorId(verifiedFactor?.id ?? null);
      setMfaHasVerifiedTotp(Boolean(verifiedFactor));
    } catch (error) {
      setMfaHasVerifiedTotp(false);
      setMfaVerifiedFactorId(null);
      setInfoMessage(error instanceof Error ? error.message : isEn ? "2FA status could not be loaded." : "2FA durumu yüklenemedi.");
    } finally {
      setMfaLoading(false);
    }
  }, [isEn]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadingError(null);

    try {
      const response = await fetch("/api/settings/profile", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as SettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error || t("settings.loadFailed"));
      }

      setFullName(payload.profile?.fullName ?? "");
      setEmail(payload.profile?.email ?? "");
      setPhone(payload.profile?.phone ?? "");
      setProfileMeta({
        userId: payload.profile?.userId ?? null,
        role: payload.profile?.role ?? null,
        createdAt: payload.profile?.createdAt ?? null,
      });
      setSubscriptions(payload.subscriptions ?? []);
      setSubscriptionMonths(payload.subscriptionMonths ?? []);
      setHasActiveSubscription(Boolean(payload.hasActiveSubscription));
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : t("settings.loadFailed"));
      setSubscriptions([]);
      setSubscriptionMonths([]);
      setHasActiveSubscription(false);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
    void refreshMfaState();
  }, [loadSettings, refreshMfaState]);

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSavingProfile(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          phone,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ProfileUpdateResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("settings.saveFailed"));
      }

      setFullName(payload.profile?.fullName ?? fullName);
      setEmail(payload.profile?.email ?? email);
      setPhone(payload.profile?.phone ?? phone);
      setInfoMessage(t("settings.saveSuccess"));
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleOpenUpgradePortal = async () => {
    setIsOpeningUpgradePortal(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/subscription/portal", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as SubscriptionPortalResponse;

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || t("settings.upgradePlanFailed"));
      }

      window.location.href = payload.url;
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.upgradePlanFailed"));
    } finally {
      setIsOpeningUpgradePortal(false);
    }
  };

  const handleOpenSubscriptionPortal = async () => {
    setIsOpeningSubscriptionPortal(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/subscription/upgrade", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as SubscriptionPortalResponse;

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || t("settings.cancelSubscriptionsFailed"));
      }

      window.location.href = payload.url;
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.cancelSubscriptionsFailed"));
    } finally {
      setIsOpeningSubscriptionPortal(false);
    }
  };

  const handleStartTotpSetup = async () => {
    setIsStartingTotpSetup(true);
    setInfoMessage(null);

    try {
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) {
        throw listed.error;
      }

      const staleFactors = ((listed.data?.all ?? []) as MfaFactor[]).filter(
        (factor) => factor.factor_type === "totp" && factor.status === "unverified"
      );

      for (const factor of staleFactors) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const enroll = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Listflow Authenticator",
      });

      if (enroll.error || !enroll.data?.totp) {
        throw new Error(enroll.error?.message || (isEn ? "2FA setup could not be started." : "2FA kurulumu başlatılamadı."));
      }

      setTotpEnrollment({
        factorId: enroll.data.id,
        qrCode: enroll.data.totp.qr_code,
        secret: enroll.data.totp.secret,
        uri: enroll.data.totp.uri,
        verificationCode: "",
      });

      setInfoMessage(isEn ? "Scan the QR code and enter the 6-digit code." : "QR kodu tarayıp 6 haneli kodu girin.");
      await refreshMfaState();
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : isEn ? "2FA setup could not be started." : "2FA kurulumu başlatılamadı.");
    } finally {
      setIsStartingTotpSetup(false);
    }
  };

  const handleCancelTotpSetup = async () => {
    if (totpEnrollment?.factorId) {
      await supabase.auth.mfa.unenroll({ factorId: totpEnrollment.factorId });
    }

    setTotpEnrollment(null);
    setInfoMessage(isEn ? "Authenticator setup canceled." : "Authenticator kurulumu iptal edildi.");
    await refreshMfaState();
  };

  const handleVerifyTotpSetup = async () => {
    if (!totpEnrollment) {
      return;
    }

    const code = totpEnrollment.verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setInfoMessage(isEn ? "Enter a valid 6-digit code." : "Geçerli bir 6 haneli kod girin.");
      return;
    }

    setIsVerifyingTotpSetup(true);
    setInfoMessage(null);

    try {
      const verified = await supabase.auth.mfa.challengeAndVerify({
        factorId: totpEnrollment.factorId,
        code,
      });

      if (verified.error) {
        throw verified.error;
      }
      await supabase.auth.signOut();
      await fetch("/api/auth/session", { method: "DELETE" });
      window.location.href = "/login?mfa=1";
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : isEn ? "2FA verification failed." : "2FA doğrulaması başarısız.");
    } finally {
      setIsVerifyingTotpSetup(false);
    }
  };

  const handleDisableTotp = async () => {
    if (!mfaVerifiedFactorId) {
      setInfoMessage(isEn ? "No active authenticator factor found." : "Aktif authenticator faktörü bulunamadı.");
      return;
    }

    if (!/^\d{6}$/.test(disableTotpCode.trim())) {
      setInfoMessage(isEn ? "Enter a valid 6-digit code." : "Geçerli bir 6 haneli kod girin.");
      return;
    }

    setIsDisablingTotp(true);
    setInfoMessage(null);

    try {
      const check = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfaVerifiedFactorId,
        code: disableTotpCode.trim(),
      });

      if (check.error) {
        throw check.error;
      }

      const unenroll = await supabase.auth.mfa.unenroll({ factorId: mfaVerifiedFactorId });
      if (unenroll.error) {
        throw unenroll.error;
      }

      setDisableTotpCode("");
      setInfoMessage(isEn ? "Two-factor authentication has been disabled." : "İki aşamalı doğrulama kapatıldı.");
      await refreshMfaState();
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : isEn ? "2FA could not be disabled." : "2FA kapatılamadı.");
    } finally {
      setIsDisablingTotp(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/account", {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as DeleteAccountResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || t("settings.deleteAccountFailed"));
      }

      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.deleteAccountFailed"));
      setIsDeletingAccount(false);
    }
  };

  const activeSubscription = useMemo(() => subscriptions.find((subscription) => subscription.isActive) ?? null, [subscriptions]);
  const historicalSubscriptions = useMemo(
    () => subscriptions.filter((subscription) => !subscription.isActive),
    [subscriptions]
  );

  const nextRenewalDate = useMemo(() => {
    const candidates = subscriptions
      .filter((row) => row.isActive && row.currentPeriodEnd)
      .map((row) => row.currentPeriodEnd as string)
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()) && value.getTime() > Date.now())
      .sort((a, b) => a.getTime() - b.getTime());

    return candidates[0]?.toISOString() ?? null;
  }, [subscriptions]);

  const activeSettingsSection = useMemo(() => resolveSettingsSection(pathname), [pathname]);

  const profileCompletion = useMemo(() => {
    const scoreBase = [fullName.trim(), email.trim(), phone.trim()].filter(Boolean).length;
    return Math.round((scoreBase / 3) * 100);
  }, [email, fullName, phone]);

  const securityScore = useMemo(() => {
    let score = 35;
    if (profileCompletion >= 67) score += 20;
    if (profileCompletion === 100) score += 10;
    if (hasActiveSubscription) score += 10;
    if (mfaHasVerifiedTotp) score += 25;
    return Math.min(score, 100);
  }, [hasActiveSubscription, mfaHasVerifiedTotp, profileCompletion]);

  const quickFacts = useMemo(
    () => [
      {
        label: isEn ? "Profile Completion" : "Profil Tamamlanma",
        value: `${profileCompletion}%`,
        accent: "text-indigo-300",
      },
      {
        label: isEn ? "Security Level" : "Güvenlik Seviyesi",
        value: `${securityScore}/100`,
        accent: "text-cyan-300",
      },
      {
        label: isEn ? "Active Plan" : "Aktif Plan",
        value: activeSubscription ? planLabel(activeSubscription.plan) : t("settings.planUnknown"),
        accent: "text-emerald-300",
      },
    ],
    [activeSubscription, isEn, planLabel, profileCompletion, securityScore, t]
  );

  const isTurboPlan = useMemo(
    () => (activeSubscription?.plan ?? "").toLowerCase() === "turbo",
    [activeSubscription?.plan]
  );

  const settingsLinks = useMemo(
    () => [
      {
        key: "profile" as const,
        href: "/settings/profile",
        label: t("settings.profileTitle"),
        icon: UserRound,
      },
      {
        key: "subscription" as const,
        href: "/settings/subscription",
        label: t("settings.subscriptionTitle"),
        icon: CreditCard,
      },
      {
        key: "security" as const,
        href: "/settings/security",
        label: t("settings.securityTitle"),
        icon: ShieldCheck,
      },
      {
        key: "account" as const,
        href: "/settings/account",
        label: t("settings.deleteAccount"),
        icon: AlertTriangle,
      },
    ],
    [t]
  );

  const qrDataUrl = useMemo(() => {
    if (!totpEnrollment?.qrCode) {
      return null;
    }
    const raw = totpEnrollment.qrCode.trim();

    if (raw.startsWith("data:image/")) {
      return raw;
    }

    if (raw.startsWith("%3Csvg") || raw.startsWith("%3csvg")) {
      return `data:image/svg+xml;utf-8,${raw}`;
    }

    if (raw.startsWith("<svg") || raw.startsWith("<?xml")) {
      return `data:image/svg+xml;utf-8,${encodeURIComponent(raw)}`;
    }

    if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
      return `data:image/svg+xml;base64,${raw}`;
    }

    return `data:image/svg+xml;utf-8,${encodeURIComponent(raw)}`;
  }, [totpEnrollment?.qrCode]);

  const renderProfileSection = () => (
    <section className="rounded-[28px] border border-zinc-200 p-6 dark:border-white/10 dark:bg-[#0e1320]">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
          <UserRound className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h3 className="text-xl font-black">{t("settings.profileTitle")}</h3>
          <p className="text-xs text-zinc-400">{t("settings.profileDescription")}</p>
        </div>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-4">
        <div>
          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {t("settings.fullName")}
          </label>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            type="text"
            className="mt-2 w-full rounded-2xl border border-zinc-200 px-4 py-3.5 text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
          />
        </div>

        <div>
          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {t("settings.email")}
          </label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            className="mt-2 w-full rounded-2xl border border-zinc-200 px-4 py-3.5 text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
          />
        </div>

        <div>
          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {t("settings.phone")}
          </label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            className="mt-2 w-full rounded-2xl border border-zinc-200 px-4 py-3.5 text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
          />
        </div>

        <button
          type="submit"
          disabled={isSavingProfile}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        >
          {isSavingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSavingProfile ? `${t("common.loading")}...` : t("settings.saveProfile")}
        </button>
      </form>
    </section>
  );

  const renderSubscriptionSection = () => (
    <section className="rounded-[28px] border border-zinc-200 p-6 dark:border-white/10 dark:bg-[#0e1320]">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
          <CreditCard className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-xl font-black">{t("settings.subscriptionTitle")}</h3>
          <p className="text-xs text-zinc-400">{t("settings.subscriptionDescription")}</p>
        </div>
      </div>

      {activeSubscription ? (
        <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
            {isEn ? "Current Active Plan" : "Mevcut Aktif Plan"}
          </p>
          <p className="mt-1 text-base font-black text-white">{planLabel(activeSubscription.plan)}</p>
          <p className="mt-1 text-xs text-slate-300">
            {t("settings.renewalDate")}: {formatDate(activeSubscription.currentPeriodEnd)}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {isEn ? "Next Renewal" : "Bir Sonraki Yenileme"}: {formatDate(nextRenewalDate)}
          </p>
        </div>
      ) : null}

      <div className="mb-5 space-y-3">
        {subscriptions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300/60 p-4 text-sm text-zinc-400 dark:border-white/10">
            {t("settings.noSubscriptions")}
          </div>
        ) : historicalSubscriptions.length === 0 ? null : (
          historicalSubscriptions.map((subscription) => (
            <div
              key={subscription.id}
              className="rounded-2xl border border-zinc-300/60 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-black">{planLabel(subscription.plan)}</p>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                  {statusLabel(subscription.status)}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {t("settings.renewalDate")}: {formatDate(subscription.currentPeriodEnd)}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="mb-5 space-y-3">
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-300">
            {isEn ? "Monthly Stripe Subscription History" : "Aylık Stripe Abonelik Geçmişi"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {isEn
              ? "All paid subscription invoices grouped month by month."
              : "Ödenen abonelik faturaları ay bazında gruplanır."}
          </p>
        </div>

        {subscriptionMonths.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300/60 p-4 text-sm text-zinc-400 dark:border-white/10">
            {isEn ? "No monthly subscription invoice history yet." : "Henüz aylık abonelik fatura geçmişi yok."}
          </div>
        ) : (
          subscriptionMonths.map((month) => {
            const [yearPart, monthPart] = month.monthKey.split("-");
            const monthDate = new Date(Number(yearPart), Number(monthPart) - 1, 1);
            const monthLabel = Number.isNaN(monthDate.getTime())
              ? month.monthKey
              : monthDate.toLocaleDateString(locale === "en" ? "en-US" : "tr-TR", {
                  year: "numeric",
                  month: "long",
                });

            return (
              <div key={month.monthKey} className="rounded-2xl border border-zinc-300/60 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black">{monthLabel}</p>
                  <p className="text-xs font-bold text-indigo-300">
                    {formatMoneyFromCents(month.totalAmountCents, month.currency)}
                  </p>
                </div>

                <div className="space-y-2">
                  {month.invoices.map((invoice) => (
                    <div key={invoice.id} className="rounded-xl border border-white/10 bg-[#101826]/70 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-bold text-slate-200">
                          {formatDate(invoice.createdAt)}
                        </p>
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                          {invoice.status ?? "-"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-slate-300">
                        {formatMoneyFromCents(invoice.amountCents, invoice.currency)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        Sub ID: {invoice.stripeSubscriptionId ?? "-"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-3">
        {!isTurboPlan ? (
          <button
            type="button"
            onClick={() => void handleOpenUpgradePortal()}
            disabled={!hasActiveSubscription || isOpeningUpgradePortal}
            className="w-full rounded-2xl border border-indigo-500/30 bg-indigo-500/10 py-3.5 text-xs font-black uppercase tracking-widest text-indigo-200 transition-all hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {isOpeningUpgradePortal ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}...
              </span>
            ) : (
              t("settings.upgradePlan")
            )}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void handleOpenSubscriptionPortal()}
          disabled={!hasActiveSubscription || isOpeningSubscriptionPortal}
          className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 py-3.5 text-xs font-black uppercase tracking-widest text-amber-200 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {isOpeningSubscriptionPortal ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}...
            </span>
          ) : (
            t("settings.cancelSubscriptions")
          )}
        </button>
      </div>
    </section>
  );

  const renderSecuritySection = () => (
    <section className="rounded-[28px] border border-zinc-200 p-6 dark:border-white/10 dark:bg-[#0e1320]">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
          <ShieldCheck className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <h3 className="text-xl font-black">{t("settings.securityTitle")}</h3>
          <p className="text-xs text-zinc-400">{isEn ? "6-digit authenticator app verification" : "6 haneli authenticator doğrulaması"}</p>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">{isEn ? "Authenticator App (TOTP)" : "Authenticator Uygulaması (TOTP)"}</p>
            <p className="mt-1 text-xs text-zinc-300">
              {isEn
                ? "Use Google Authenticator, Microsoft Authenticator or 1Password to generate 6-digit login codes."
                : "Google Authenticator, Microsoft Authenticator veya 1Password ile 6 haneli giriş kodu üretin."}
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
              mfaHasVerifiedTotp
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                : "border-amber-400/40 bg-amber-500/20 text-amber-200"
            }`}
          >
            {mfaLoading ? (isEn ? "Checking..." : "Kontrol ediliyor...") : mfaHasVerifiedTotp ? (isEn ? "Enabled" : "Aktif") : (isEn ? "Disabled" : "Kapalı")}
          </span>
        </div>

      </div>

      {!mfaHasVerifiedTotp && !totpEnrollment ? (
        <button
          type="button"
          onClick={() => void handleStartTotpSetup()}
          disabled={isStartingTotpSetup || mfaLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-[#10293a] py-3 text-xs font-black uppercase tracking-widest text-cyan-100 transition-all hover:bg-cyan-600/20 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        >
          {isStartingTotpSetup ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {isEn ? "Set Up Authenticator" : "Authenticator Kur"}
        </button>
      ) : null}

      {totpEnrollment ? (
        <p className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-xs font-semibold text-indigo-100">
          {isEn
            ? "Authenticator setup modal is open. Scan QR and verify your code."
            : "Authenticator kurulum modalı açık. QR kodu tarayıp doğrulama kodunuzu girin."}
        </p>
      ) : null}

      {mfaHasVerifiedTotp ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-black text-red-100">{isEn ? "Disable 2FA" : "2FA Kapat"}</p>
          <p className="text-xs text-red-200/80">
            {isEn
              ? "Enter a fresh 6-digit code from your authenticator app to disable 2FA."
              : "2FA kapatmak için authenticator uygulamasından güncel 6 haneli kodu girin."}
          </p>
          <input
            value={disableTotpCode}
            onChange={(event) => setDisableTotpCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            className="w-full rounded-xl border border-white/10 bg-[#2c1216] px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            type="button"
            onClick={() => void handleDisableTotp()}
            disabled={isDisablingTotp}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-600/20 py-3 text-xs font-black uppercase tracking-widest text-red-100 transition-all hover:bg-red-600/30 disabled:opacity-60 cursor-pointer"
          >
            {isDisablingTotp ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEn ? "Disable Authenticator" : "Authenticator'ı Kapat"}
          </button>
        </div>
      ) : null}
    </section>
  );

  const renderAccountSection = () => (
    <section className="rounded-[28px] border border-red-500/30 p-6 dark:bg-[#120f15]">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-300" />
        </div>
        <div>
          <h3 className="text-xl font-black text-white">{t("settings.deleteAccount")}</h3>
          <p className="text-xs text-zinc-300">{t("settings.deleteAccountWarning")}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowDeleteAccountModal(true)}
        className="w-full rounded-2xl bg-red-950/60 py-3.5 text-xs font-black uppercase tracking-widest text-white/70 transition-all hover:bg-red-500 hover:text-white cursor-pointer"
      >
        {t("settings.deleteAccount")}
      </button>
    </section>
  );

  const renderSectionContent = () => {
    if (activeSettingsSection === "profile") {
      return renderProfileSection();
    }

    if (activeSettingsSection === "subscription") {
      return renderSubscriptionSection();
    }

    if (activeSettingsSection === "security") {
      return renderSecuritySection();
    }

    return renderAccountSection();
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar pr-2 pt-2">

      {loading ? (
        <div className="rounded-[32px] border border-white/10 bg-[#101626] p-16 text-center">
          <p className="text-zinc-400 font-medium">{t("common.loading")}...</p>
        </div>
      ) : null}

      {!loading && loadingError ? (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {loadingError}
        </div>
      ) : null}

      {!loading && !loadingError ? (
        <div className="space-y-6 pb-8">
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0f1422]/95 p-7 shadow-[0_24px_70px_rgba(5,10,28,0.5)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-20 -top-20 h-52 w-52 rounded-full bg-indigo-500/20 blur-3xl" />
              <div className="absolute -right-20 bottom-[-60px] h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />
            </div>

            <div className="relative grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                    {isEn ? "Account Trust Center" : "Hesap Güven Merkezi"}
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {isEn
                    ? "Manage account, security, and billing from one place"
                    : "Hesap, güvenlik ve faturalandırmayı tek merkezden yönet"}
                </h2>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-relaxed text-slate-300">
                  {isEn
                    ? "Profile consistency, 2FA verification and subscription visibility directly improve account trust."
                    : "Profil tutarlılığı, 2FA doğrulaması ve abonelik görünürlüğü hesap güvenini doğrudan artırır."}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {profileMeta.role === "admin" ? (isEn ? "Admin Account" : "Admin Hesabı") : (isEn ? "User Account" : "Kullanıcı Hesabı")}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {isEn ? "Created" : "Oluşturulma"}: {formatDate(profileMeta.createdAt)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {quickFacts.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-[#111a2d]/80 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <p className={`mt-2 text-lg font-black ${item.accent}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="rounded-[24px] border border-white/10 bg-[#0f1420] p-3">
              <div className="space-y-2">
                {settingsLinks.map((item) => {
                  const active = activeSettingsSection === item.key;

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition-all ${
                        active
                          ? "border border-indigo-500/40 bg-indigo-600/15 text-white"
                          : "border border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <item.icon className={`h-4 w-4 ${active ? "text-indigo-300" : "text-slate-400 group-hover:text-indigo-300"}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </aside>

            <div>{renderSectionContent()}</div>
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {totpEnrollment ? (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-2xl rounded-[30px] border border-indigo-400/30 bg-[#0f1526] p-6 shadow-[0_30px_90px_rgba(5,10,28,0.8)] sm:p-8"
            >
              <div className="mb-4 flex items-center gap-2 text-indigo-100">
                <QrCode className="h-5 w-5" />
                <p className="text-sm font-black uppercase tracking-[0.14em]">
                  {isEn ? "Step 1: Scan QR Code" : "Adım 1: QR Kodu Tara"}
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="flex justify-center lg:justify-start">
                  {qrDataUrl ? (
                    <div className="relative h-[320px] w-[320px] rounded-[22px] bg-white p-4 shadow-2xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrDataUrl}
                        alt={isEn ? "Authenticator QR" : "Authenticator QR"}
                        className="h-full w-full"
                      />
                      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-indigo-300/40 bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.5)]">
                        <Rocket className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-[320px] w-[320px] items-center justify-center rounded-[22px] border border-white/10 bg-[#11192d] text-xs text-slate-400">
                      {isEn ? "QR could not be generated." : "QR kod üretilemedi."}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-[#0f1528]/80 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {isEn ? "Manual Secret" : "Manuel Gizli Anahtar"}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-100">{totpEnrollment.secret}</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-indigo-100">
                      {isEn ? "Step 2: Enter 6-digit code" : "Adım 2: 6 haneli kodu gir"}
                    </label>
                    <input
                      value={totpEnrollment.verificationCode}
                      onChange={(event) =>
                        setTotpEnrollment((current) =>
                          current
                            ? {
                                ...current,
                                verificationCode: event.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                              }
                            : current
                        )
                      }
                      inputMode="numeric"
                      maxLength={6}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-[#0f1628] px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleVerifyTotpSetup()}
                      disabled={isVerifyingTotpSetup}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
                    >
                      {isVerifyingTotpSetup ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {isEn ? "Verify & Enable" : "Doğrula ve Etkinleştir"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCancelTotpSetup()}
                      className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-300 transition-all hover:text-white cursor-pointer"
                    >
                      {t("settings.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}

        {showDeleteAccountModal ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeletingAccount && setShowDeleteAccountModal(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg rounded-[32px] border border-red-500/30 bg-[#120b0b] p-8 shadow-2xl"
            >
              <h3 className="mb-2 text-2xl font-black text-white">{t("settings.deleteAccountConfirmTitle")}</h3>
              <p className="mb-3 text-sm text-red-100">{t("settings.deleteAccountConfirmText")}</p>
              <p className="mb-6 text-xs font-bold text-red-200/70">{t("settings.deleteAccountWarning")}</p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteAccountModal(false)}
                  disabled={isDeletingAccount}
                  className="flex-1 rounded-xl border border-white/10 py-3 text-xs font-black uppercase tracking-widest text-slate-300 transition-all hover:text-white disabled:opacity-60 cursor-pointer"
                >
                  {t("settings.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAccount()}
                  disabled={isDeletingAccount}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600/90 py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-red-500 disabled:opacity-60 cursor-pointer"
                >
                  {isDeletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("settings.deleteAccountApprove")}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default SettingsPanel;
