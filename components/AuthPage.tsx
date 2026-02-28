"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "../store";
import { View } from "../types";
import { supabase } from "../lib/supabaseClient";
import { ArrowLeft, Loader2, Lock, Mail, Rocket, ShieldCheck, User } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { buildOAuthRedirectTo } from "@/lib/auth/oauth-client";
import { toast } from "sonner";

const REFERRAL_STORAGE_KEY = "listflow:pending_ref";

const captureReferralCode = (code: string | null) => {
  if (!code || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, code.toUpperCase());
  } catch {
    // storage not available
  }
};

const consumeReferralCode = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const code = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (code) window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
    return code;
  } catch {
    return null;
  }
};

const trackReferralSignup = async (referralCode: string, referredUserId: string) => {
  try {
    await fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "track_signup", referralCode, referredUserId }),
    });
  } catch {
    // silent — referral tracking should not block auth flow
  }
};

type AuthPageProps = {
  standalone?: boolean;
};

type MfaFactor = {
  id: string;
  factor_type: string;
  status: string;
};

const isLegacyOnboardingRequired = (user: User | null | undefined) => {
  if (!user) {
    return false;
  }

  const metadata =
    typeof user.user_metadata === "object" && user.user_metadata !== null
      ? (user.user_metadata as Record<string, unknown>)
      : null;

  return Boolean(metadata?.legacy_onboarding_required);
};

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path
      d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.12 2.78-2.38 3.64v2.42h3.84c2.25-2.07 3.54-5.13 3.54-8.77 0-.75-.07-1.48-.2-2.19Z"
      fill="#4285F4"
    />
    <path
      d="M12 22c3.02 0 5.55-1 7.4-2.71l-3.84-2.42c-1.07.72-2.44 1.15-3.56 1.15-2.73 0-5.05-1.84-5.88-4.32H2.16v2.48A10 10 0 0 0 12 22Z"
      fill="#34A853"
    />
    <path
      d="M6.12 13.7A5.98 5.98 0 0 1 5.8 12c0-.59.1-1.16.32-1.7V7.82H2.16A10 10 0 0 0 1 12c0 1.61.38 3.14 1.16 4.18l3.96-2.48Z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.98c1.64 0 3.11.56 4.27 1.66l3.2-3.2C17.55 2.66 15.02 2 12 2A10 10 0 0 0 2.16 7.82L6.12 10.3c.83-2.48 3.15-4.32 5.88-4.32Z"
      fill="#EA4335"
    />
  </svg>
);

const AuthPage: React.FC<AuthPageProps> = ({ standalone = false }) => {
  const { setView } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<{ message: string; type: "error" | "success" } | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [mfaHintEmail, setMfaHintEmail] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const marketingPoints = useMemo(
    () =>
      locale === "en"
        ? [
            "Trend-focused AI product generation for Etsy",
            "Automatic listing flow with less manual work",
            "Category-based scaling for faster store growth",
          ]
        : [
            "Etsy için trend odaklı AI ürün üretimi",
            "Daha az manuel işlemle otomatik listeleme akışı",
            "Kategori bazlı ölçekleme ile daha hızlı mağaza büyümesi",
          ],
    [locale]
  );

  const resolveMfaRequirement = useCallback(async () => {
    const [factorsResult, aalResult, userResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.getUser(),
    ]);

    if (factorsResult.error) {
      throw factorsResult.error;
    }

    if (aalResult.error) {
      throw aalResult.error;
    }

    const verifiedTotpFactor =
      ((factorsResult.data?.all ?? []) as MfaFactor[]).find(
        (factor) => factor.factor_type === "totp" && factor.status === "verified"
      ) ?? null;

    const requiresMfa =
      Boolean(verifiedTotpFactor) &&
      aalResult.data?.nextLevel === "aal2" &&
      aalResult.data?.currentLevel !== "aal2";

    if (requiresMfa) {
      setMfaRequired(true);
      setMfaFactorId(verifiedTotpFactor?.id ?? null);
      setMfaHintEmail(userResult.data.user?.email ?? "");
      return true;
    }

    setMfaRequired(false);
    setMfaFactorId(null);
    setMfaCode("");
    setMfaHintEmail("");
    return false;
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }

    if (error.type === "success") {
      toast.success(error.message);
      return;
    }

    toast.error(error.message);
  }, [error]);

  // Capture ?ref=CODE from URL into localStorage so it survives page transitions
  useEffect(() => {
    const refCode = searchParams?.get("ref");
    if (refCode) {
      captureReferralCode(refCode);
      // Auto-switch to signup mode when arriving via referral link
      setIsLogin(false);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!standalone) {
      return;
    }

    let active = true;
    const redirectIfAuthenticated = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active || !session) {
        return;
      }

      const requiresMfa = await resolveMfaRequirement();
      if (!active || requiresMfa) {
        return;
      }

      if (isLegacyOnboardingRequired(session.user)) {
        setView(View.DASHBOARD);
        router.replace("/legacy-onboarding");
        return;
      }

      setView(View.DASHBOARD);
      router.replace("/categories");
    };

    void redirectIfAuthenticated();

    return () => {
      active = false;
    };
  }, [resolveMfaRequirement, router, setView, standalone]);

  useEffect(() => {
    if (!standalone || typeof window === "undefined") {
      return;
    }

    const styleId = "listflow-login-hide-crisp";
    let hideStyle = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!hideStyle) {
      hideStyle = document.createElement("style");
      hideStyle.id = styleId;
      hideStyle.textContent = "#crisp-chatbox, #crisp-client, .crisp-client { display: none !important; }";
      document.head.appendChild(hideStyle);
    }

    const pushHide = () => {
      const crispWindow = window as Window & { $crisp?: unknown[] };
      if (!Array.isArray(crispWindow.$crisp)) {
        crispWindow.$crisp = [];
      }

      crispWindow.$crisp.push(["do", "chat:hide"]);
      crispWindow.$crisp.push(["do", "chat:close"]);
    };

    pushHide();
    const hideTimer = window.setTimeout(pushHide, 300);

    return () => {
      window.clearTimeout(hideTimer);
      hideStyle?.remove();
    };
  }, [standalone]);

  const validateEmail = (value: string) => {
    return String(value)
      .toLowerCase()
      .match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
  };

  const bootstrapProfile = async (accessToken: string, refreshToken?: string, name?: string) => {
    await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        accessToken,
        refreshToken,
        fullName: name,
        locale,
      }),
    });
  };

  const handleSuccessfulAuth = (user: User | null | undefined) => {
    if (isLegacyOnboardingRequired(user)) {
      setView(View.DASHBOARD);
      router.replace("/legacy-onboarding");
      return;
    }

    setView(View.DASHBOARD);

    if (standalone) {
      router.push("/categories");
      return;
    }

    setView(View.DASHBOARD);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || googleLoading) {
      return;
    }

    setError(null);
    const cleanEmail = email.trim();
    const cleanFullName = fullName.trim();

    if (!validateEmail(cleanEmail)) {
      setError({ message: t("auth.validationEmail"), type: "error" });
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) {
          throw signInError;
        }

        if (data.session?.access_token) {
          const requiresMfa = await resolveMfaRequirement();
          if (requiresMfa) {
            return;
          }

          await bootstrapProfile(data.session.access_token, data.session.refresh_token ?? undefined);
          handleSuccessfulAuth(data.user ?? data.session.user);
        }
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanFullName,
              display_name: cleanFullName,
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session?.access_token) {
          await bootstrapProfile(
            data.session.access_token,
            data.session.refresh_token ?? undefined,
            cleanFullName
          );

          // Track referral signup if a ref code was captured
          if (data.user?.id) {
            const pendingRef = consumeReferralCode();
            if (pendingRef) {
              void trackReferralSignup(pendingRef, data.user.id);
            }
          }

          handleSuccessfulAuth(data.user ?? data.session.user);
          return;
        }

        setError({
          message: t("auth.signupSuccess"),
          type: "success",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("auth.genericError");
      const formatted = message.toLowerCase().includes("rate limit") ? t("auth.rateLimit") : message;
      setError({ message: formatted, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleOAuth = async () => {
    if (loading || googleLoading) {
      return;
    }

    setGoogleLoading(true);
    setError(null);

    try {
      const nextPath = standalone ? "/login" : "/";
      const redirectTo = buildOAuthRedirectTo(
        `/auth/callback?next=${encodeURIComponent(nextPath)}`
      );

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("auth.genericError");
      setError({ message, type: "error" });
      setGoogleLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    if (!mfaFactorId) {
      setError({ message: t("auth.genericError"), type: "error" });
      return;
    }

    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError({
        message: locale === "en" ? "Enter a valid 6-digit code." : "Geçerli bir 6 haneli kod girin.",
        type: "error",
      });
      return;
    }

    setMfaVerifying(true);
    setError(null);

    try {
      const verification = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfaFactorId,
        code,
      });

      if (verification.error) {
        throw verification.error;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        await bootstrapProfile(session.access_token, session.refresh_token ?? undefined);
      }

      setMfaRequired(false);
      setMfaFactorId(null);
      setMfaCode("");
      setMfaHintEmail("");
      handleSuccessfulAuth(session?.user ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("auth.genericError");
      setError({ message, type: "error" });
    } finally {
      setMfaVerifying(false);
    }
  };

  const handleMfaSignOut = async () => {
    await supabase.auth.signOut();
    await fetch("/api/auth/session", { method: "DELETE" });
    setMfaRequired(false);
    setMfaFactorId(null);
    setMfaCode("");
    setMfaHintEmail("");
    router.replace("/login");
  };

  const goBack = () => {
    if (standalone) {
      router.push("/");
      return;
    }

    setView(View.LANDING);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07090f] px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-220px] h-[460px] w-[460px] rounded-full bg-indigo-600/30 blur-[150px]" />
        <div className="absolute right-[-140px] top-16 h-[360px] w-[360px] rounded-full bg-cyan-500/20 blur-[140px]" />
        <div className="absolute bottom-[-220px] left-1/2 h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-[160px]" />
      </div>

      <button
        onClick={goBack}
        className="absolute left-4 top-4 z-50 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-300 transition-all hover:text-white sm:left-8 sm:top-8 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        {locale === "en" ? "Back" : "Geri"}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 mx-auto mt-12 grid w-full max-w-6xl overflow-hidden rounded-[34px] border border-white/15 bg-[#0d111b]/92 shadow-[0_25px_80px_rgba(5,10,25,0.65)] backdrop-blur-xl lg:mt-16 lg:grid-cols-[1.05fr_0.95fr]"
      >
        <div className="relative hidden border-r border-white/10 px-10 py-12 lg:block">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_28px_rgba(79,70,229,0.35)]">
              <Rocket className="h-5 w-5 text-white" />
            </div>
            <p className="text-xl font-black tracking-tight text-white">
              listflow<span className="text-indigo-400">.pro</span>
            </p>
          </div>

          <h1 className="max-w-md text-4xl font-black leading-[1.05] tracking-tight text-white">
            {locale === "en"
              ? "Scale Etsy listings with a clean automation workflow"
              : "Etsy listelemelerini güçlü bir otomasyon akışıyla ölçekle"}
          </h1>

          <p className="mt-4 max-w-md text-sm font-semibold leading-relaxed text-slate-300">
            {locale === "en"
              ? "Sign in to access your store workflows, category logic, and production-ready dashboard."
              : "Mağaza akışlarına, kategori yönetimine ve üretime hazır dashboard'a erişmek için giriş yap."}
          </p>

          <div className="mt-8 space-y-3">
            {marketingPoints.map((point) => (
              <div
                key={point}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200"
              >
                {point}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="mb-8 lg:hidden">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_24px_rgba(79,70,229,0.35)]">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <p className="text-xl font-black tracking-tight text-white">
                listflow<span className="text-indigo-400">.pro</span>
              </p>
            </div>
            <p className="text-sm font-semibold text-slate-300">
              {locale === "en"
                ? "Access your automation dashboard and continue your workflow."
                : "Otomasyon dashboarduna eriş ve iş akışına kaldığın yerden devam et."}
            </p>
          </div>

          {mfaRequired ? (
            <div className="space-y-6 rounded-2xl border border-indigo-500/30 bg-[#0f172a]/75 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600/25">
                  <ShieldCheck className="h-5 w-5 text-indigo-200" />
                </div>
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-white">
                    {locale === "en" ? "Two-Factor Verification" : "İki Aşamalı Doğrulama"}
                  </h2>
                  <p className="text-xs font-semibold text-slate-400">
                    {locale === "en"
                      ? "Enter your 6-digit authenticator code to continue."
                      : "Devam etmek için authenticator uygulamanızdaki 6 haneli kodu girin."}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {locale === "en" ? "Account" : "Hesap"}
                </p>
                <p className="mt-1 text-sm font-bold text-white">{mfaHintEmail || "-"}</p>
              </div>

              <div>
                <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {locale === "en" ? "6-digit code" : "6 haneli kod"}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-center text-xl font-black tracking-[0.35em] text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                  placeholder="000000"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleVerifyMfa()}
                  disabled={mfaVerifying}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {mfaVerifying ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {locale === "en" ? "Verify" : "Doğrula"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleMfaSignOut()}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-300 transition-all hover:border-red-400/50 hover:text-white cursor-pointer"
                >
                  {locale === "en" ? "Sign Out" : "Çıkış Yap"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-3xl font-black tracking-tight text-white">
                  {isLogin ? t("auth.welcome") : t("auth.createAccount")}
                </h2>
                <p className="mt-2 text-sm font-semibold text-slate-400">
                  {isLogin
                    ? locale === "en"
                      ? "Use your account to continue."
                      : "Devam etmek için hesabını kullan."
                    : locale === "en"
                      ? "Create your account and launch quickly."
                      : "Hesabını oluştur ve hızlıca başla."}
                </p>
              </div>

              <div className="mb-6 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(true);
                    setError(null);
                  }}
                  className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all cursor-pointer ${
                    isLogin ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {locale === "en" ? "Sign In" : "Giriş"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(false);
                    setError(null);
                  }}
                  className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all cursor-pointer ${
                    !isLogin ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {locale === "en" ? "Sign Up" : "Kayıt"}
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin ? (
                  <div className="space-y-2">
                    <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      {t("auth.name")}
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm font-semibold text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                        placeholder={locale === "en" ? "Alex Carter" : "Mert Demir"}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {t("auth.email")}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm font-semibold text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                      placeholder="ornek@mail.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {t("auth.password")}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm font-semibold text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {loading ? (locale === "en" ? "Please wait..." : "Lütfen bekleyin...") : isLogin ? t("auth.submitLogin") : t("auth.submitSignup")}
                </button>

                <button
                  type="button"
                  onClick={handleGoogleOAuth}
                  disabled={loading || googleLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-sm font-black text-white transition-all hover:border-indigo-400/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {googleLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
                  {googleLoading ? (locale === "en" ? "Redirecting..." : "Yönlendiriliyor...") : t("auth.google")}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setIsLogin((prev) => !prev);
                    setError(null);
                  }}
                  className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-indigo-300 cursor-pointer"
                >
                  {isLogin ? t("auth.noAccount") : t("auth.hasAccount")}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
