"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Lock, Rocket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n/provider";

const hashToParams = (hash: string) => {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(normalized);
};

const ResetPasswordPage: React.FC = () => {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authError = useMemo(() => searchParams.get("authError") ?? "", [searchParams]);

  useEffect(() => {
    let active = true;

    const syncRecoverySession = async () => {
      try {
        const hashParams = typeof window !== "undefined" ? hashToParams(window.location.hash) : null;
        const hashAccessToken = hashParams?.get("access_token") ?? null;
        const hashRefreshToken = hashParams?.get("refresh_token") ?? null;

        if (hashAccessToken) {
          await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: hashAccessToken,
              refreshToken: hashRefreshToken,
            }),
          });

          if (typeof window !== "undefined") {
            const nextUrl = `${window.location.pathname}${window.location.search}`;
            window.history.replaceState({}, "", nextUrl);
          }
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.access_token) {
            await fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accessToken: session.access_token,
                refreshToken: session.refresh_token,
              }),
            });
          }
        }
      } catch {
        // silent; submit step will surface auth error if session is still missing
      } finally {
        if (active) {
          setIsHydratingSession(false);
        }
      }
    };

    void syncRecoverySession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authError) {
      return;
    }

    const translated =
      locale === "en"
        ? "Your reset link is invalid or expired. Request a new one."
        : "Şifre sıfırlama linkiniz geçersiz veya süresi dolmuş. Yeni bir link isteyin.";
    setError(translated);
  }, [authError, locale]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextPassword = password.trim();
    const nextPasswordConfirm = passwordConfirm.trim();

    if (nextPassword.length < 8) {
      setError(t("auth.resetPasswordTooShort"));
      return;
    }

    if (nextPassword !== nextPasswordConfirm) {
      setError(t("auth.resetPasswordMismatch"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nextPassword }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || t("auth.resetPasswordInvalid"));
      }

      await supabase.auth.signOut().catch(() => undefined);
      toast.success(t("auth.resetPasswordSuccess"));
      router.replace("/login?reset=success");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth.resetPasswordInvalid"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen min-h-[100dvh] overflow-hidden bg-[#07090f] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-220px] h-[460px] w-[460px] rounded-full bg-indigo-600/30 blur-[150px]" />
        <div className="absolute right-[-140px] top-16 h-[360px] w-[360px] rounded-full bg-cyan-500/20 blur-[140px]" />
      </div>

      <button
        onClick={() => router.push("/login")}
        className="absolute left-3 top-3 z-50 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-300 transition-all hover:text-white sm:left-8 sm:top-8 sm:text-xs cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        {locale === "en" ? "Back to Login" : "Girişe Dön"}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 mx-auto mt-16 w-full max-w-xl overflow-hidden rounded-[26px] border border-white/15 bg-[#0d111b]/92 shadow-[0_25px_80px_rgba(5,10,25,0.65)] backdrop-blur-xl sm:rounded-[34px]"
      >
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_24px_rgba(79,70,229,0.35)]">
              <Rocket className="h-5 w-5 text-white" />
            </div>
            <p className="text-xl font-black tracking-tight text-white">
              listflow<span className="text-indigo-400">.pro</span>
            </p>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              {t("auth.resetPasswordTitle")}
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-400">
              {t("auth.resetPasswordDescription")}
            </p>
          </div>

          {error ? (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                {t("auth.newPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm font-semibold text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                {t("auth.confirmPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm font-semibold text-white outline-none ring-indigo-500/40 transition-all placeholder:text-slate-500 focus:ring-2"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || isHydratingSession}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting || isHydratingSession ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {isHydratingSession ? t("common.loading") : t("auth.resetPasswordSubmit")}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default ResetPasswordPage;
