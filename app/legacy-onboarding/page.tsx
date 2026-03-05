"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType, Session, User } from "@supabase/supabase-js";
import { Loader2, Rocket, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { sanitizePhoneInput } from "@/lib/phone";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { supabase, SUPABASE_URL } from "@/lib/supabaseClient";

type StoreCurrency = "USD" | "TRY";
type LegacyOnboardingStep = 1 | 2;
type LegacyBootstrapUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  legacyOnboardingRequired: boolean;
  legacyPasswordSet: boolean;
};

const LISTFLOW_DECIDE_VALUE = "__listflow_decide__";

const syncServerSession = async (session: Session | null) => {
  if (session?.access_token) {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });
    return;
  }
};

const buildAuthHeaders = (accessToken: string | null | undefined) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stripUrlAuthArtifacts = () => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const removableParams = [
    "token_hash",
    "type",
    "code",
    "authError",
    "access_token",
    "refresh_token",
    "expires_in",
    "expires_at",
    "token_type",
    "ml",
  ];

  let changed = false;
  for (const key of removableParams) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (url.hash) {
    changed = true;
  }

  if (changed) {
    const query = url.searchParams.toString();
    const next = `${url.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", next);
  }
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(paddingNeeded)}`;
  return atob(padded);
};

const verifyRelayMagicLink = async () => {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const encoded = url.searchParams.get("ml");
  if (!encoded) {
    return null;
  }

  try {
    const decoded = decodeBase64Url(encoded);
    const target = new URL(decoded);
    const supabaseHost = new URL(SUPABASE_URL).host;
    const isTrustedHost = target.host === supabaseHost;
    const isVerifyPath = target.pathname.includes("/auth/v1/verify");

    if (!isTrustedHost || !isVerifyPath) {
      return null;
    }

    const code = target.searchParams.get("code");
    if (code) {
      const exchanged = await supabase.auth.exchangeCodeForSession(code);
      if (!exchanged.error && exchanged.data.session) {
        stripUrlAuthArtifacts();
        return exchanged.data.session;
      }
    }

    const tokenHash = target.searchParams.get("token_hash") ?? target.searchParams.get("token");
    const tokenType = target.searchParams.get("type");
    if (tokenHash) {
      const verify = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: ((tokenType || "magiclink") as EmailOtpType),
      });

      if (!verify.error && verify.data.session) {
        stripUrlAuthArtifacts();
        return verify.data.session;
      }
    }

    return null;
  } catch {
    return null;
  }
};

const resolveAuthErrorMessageFromUrl = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const queryError = (url.searchParams.get("authError") ?? "").trim().toLowerCase();
  const hashRaw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hashRaw);
  const hashErrorCode = (hashParams.get("error_code") ?? "").trim().toLowerCase();
  const hashError = (hashParams.get("error") ?? "").trim().toLowerCase();

  if (hashErrorCode === "otp_expired") {
    return "Magic link süresi dolmuş veya geçersiz. Admin panelden yeni magic link üretip tekrar deneyin.";
  }

  if (hashErrorCode === "otp_disabled") {
    return "Magic link doğrulaması şu an devre dışı görünüyor. Lütfen destek ile iletişime geçin.";
  }

  if (hashError === "access_denied") {
    return "Magic link doğrulanamadı. Lütfen yeni bir onboarding linki kullanın.";
  }

  if (queryError === "oauth_failed") {
    return "Auth callback başarısız oldu. Lütfen yeni bir magic link ile tekrar deneyin.";
  }

  if (queryError === "missing_code") {
    return "Magic link doğrulama kodu eksik. Yeni bir onboarding linki ile tekrar deneyin.";
  }

  return null;
};

const recoverSessionFromUrl = async () => {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const authCode = url.searchParams.get("code");
  if (authCode) {
    const exchanged = await supabase.auth.exchangeCodeForSession(authCode);
    if (!exchanged.error && exchanged.data.session) {
      stripUrlAuthArtifacts();
      return exchanged.data.session;
    }
  }

  const tokenHash = url.searchParams.get("token_hash");
  const tokenType = url.searchParams.get("type");

  if (tokenHash && tokenType) {
    const verify = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tokenType as EmailOtpType,
    });

    if (!verify.error && verify.data.session) {
      stripUrlAuthArtifacts();
      return verify.data.session;
    }
  }

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");

  if (accessToken && refreshToken) {
    const setSession = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (!setSession.error && setSession.data.session) {
      stripUrlAuthArtifacts();
      return setSession.data.session;
    }
  }

  return null;
};

const resolveStableSession = async () => {
  const initial = await supabase.auth.getSession();
  if (initial.data.session) {
    return initial.data.session;
  }

  const recovered = await recoverSessionFromUrl();
  if (recovered) {
    return recovered;
  }

  for (const delayMs of [250, 500, 1000]) {
    await wait(delayMs);
    const retried = await supabase.auth.getSession();
    if (retried.data.session) {
      return retried.data.session;
    }
  }

  return null;
};

const ensureFreshSessionAfterPasswordSet = async (args: { email: string; password: string }): Promise<Session | null> => {
  // Try refresh first (may fail if password change invalidated the session)
  const refreshed = await supabase.auth.refreshSession();
  if (!refreshed.error && refreshed.data.session?.access_token) {
    await syncServerSession(refreshed.data.session);
    return refreshed.data.session;
  }

  // Sign in with the new password — use trimmed version to match server-side storage
  const relogin = await supabase.auth.signInWithPassword({
    email: args.email,
    password: args.password.trim(),
  });

  if (!relogin.error && relogin.data.session?.access_token) {
    await syncServerSession(relogin.data.session);
    return relogin.data.session;
  }

  // Both failed — fall back to whatever session the client still has.
  // The access token may still be valid even though the refresh token was revoked.
  const fallback = (await supabase.auth.getSession()).data.session ?? null;
  return fallback;
};

const loadLegacyUserFromServerSession = async (): Promise<LegacyBootstrapUser | null> => {
  const response = await fetch("/api/legacy-onboarding/profile", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as {
    user?: LegacyBootstrapUser;
  };

  return payload.user ?? null;
};

const getUserMetadata = (user: User | null | undefined) => {
  if (!user || typeof user.user_metadata !== "object" || user.user_metadata === null) {
    return {} as Record<string, unknown>;
  }

  return user.user_metadata as Record<string, unknown>;
};

const isLegacyOnboardingRequired = (user: User | null | undefined) => {
  return Boolean(getUserMetadata(user).legacy_onboarding_required);
};

const isLegacyPasswordSet = (user: User | null | undefined) => {
  return Boolean(getUserMetadata(user).legacy_password_set);
};

export default function LegacyOnboardingPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessionResolveError, setSessionResolveError] = useState<string | null>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [currentStep, setCurrentStep] = useState<LegacyOnboardingStep>(1);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);

  const [storeName, setStoreName] = useState("");
  const [selectedParentCategoryId, setSelectedParentCategoryId] = useState("");
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState("");
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>("USD");

  const saveLegacyProfile = async (args: { fullName: string; phone: string; password?: string }) => {
    const session = await getFreshAuthorizedSession();
    if (!session?.access_token) {
      throw new Error("Onboarding oturumu doğrulanamadı. Lütfen magic linki yeniden açın.");
    }
    const response = await fetch("/api/legacy-onboarding/profile", {
      method: "POST",
      headers: buildAuthHeaders(session?.access_token),
      credentials: "include",
      body: JSON.stringify({
        fullName: args.fullName,
        phone: args.phone || null,
        password: args.password,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      profile?: { fullName?: string | null; phone?: string | null };
    };

    if (!response.ok) {
      throw new Error(payload.error || "Profil güncellenemedi.");
    }

    if (typeof payload.profile?.fullName === "string") {
      setFullName(payload.profile.fullName);
    }
    if (typeof payload.profile?.phone === "string") {
      setPhone(payload.profile.phone);
    }
  };

  const getFreshAuthorizedSession = async () => {
    const current = activeSession ?? (await supabase.auth.getSession()).data.session ?? null;

    if (current?.access_token) {
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session?.access_token) {
        await syncServerSession(refreshed.data.session);
        setActiveSession(refreshed.data.session);
        return refreshed.data.session;
      }

      await syncServerSession(current);
      setActiveSession(current);
      return current;
    }

    const resolved = await resolveStableSession();
    if (resolved?.access_token) {
      await syncServerSession(resolved);
      setActiveSession(resolved);
      return resolved;
    }

    return null;
  };

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

  useEffect(() => {
    let active = true;

    const hydrateStateFromUser = (user: User, fallback: LegacyBootstrapUser | null = null) => {
      const requiresLegacy = fallback ? fallback.legacyOnboardingRequired : isLegacyOnboardingRequired(user);
      if (!requiresLegacy) {
        router.replace("/categories");
        return;
      }

      const metadata = getUserMetadata(user);
      const nextPasswordSet = fallback ? fallback.legacyPasswordSet : isLegacyPasswordSet(user);
      const incomingName =
        typeof metadata.full_name === "string"
          ? metadata.full_name
          : (fallback?.fullName ?? "");
      const incomingPhone = typeof metadata.phone === "string" ? metadata.phone : (fallback?.phone ?? "");

      setCurrentUser(user);
      setPasswordSet(nextPasswordSet);
      setCurrentStep(nextPasswordSet ? 2 : 1);
      setFullName(incomingName);
      setPhone(incomingPhone);
      setSessionResolveError(null);
    };

    const hydrateFromServerFallback = async () => {
      const fallback = await loadLegacyUserFromServerSession();
      if (!fallback) {
        setCurrentUser(null);
        setSessionResolveError("Oturum doğrulanamadı. Magic linki yeniden açın.");
        return;
      }

      const pseudoUser = ({
        id: fallback.id,
        email: fallback.email,
        user_metadata: {
          full_name: fallback.fullName,
          phone: fallback.phone,
          legacy_onboarding_required: fallback.legacyOnboardingRequired,
          legacy_password_set: fallback.legacyPasswordSet,
        },
      } as unknown) as User;

      hydrateStateFromUser(pseudoUser, fallback);
    };

    const bootstrap = async () => {
      try {
        let session = await verifyRelayMagicLink();
        if (session?.access_token) {
          await syncServerSession(session);
          setActiveSession(session);
        }

        const urlAuthError = resolveAuthErrorMessageFromUrl();
        if (urlAuthError) {
          setSessionResolveError(urlAuthError);
        }

        if (!session?.access_token) {
          session = await resolveStableSession();
        }

        await syncServerSession(session);
        setActiveSession(session ?? null);

        if (!active) {
          return;
        }

        if (!session?.user) {
          await hydrateFromServerFallback();
          return;
        }

        hydrateStateFromUser(session.user);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Onboarding başlatılamadı.";
        toast.error(message);
        setCurrentUser(null);
        setSessionResolveError(resolveAuthErrorMessageFromUrl() ?? "Oturum doğrulanamadı. Magic linki yeniden açın.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, incomingSession) => {
      let session = incomingSession;
      if (!session) {
        session = await resolveStableSession();
      }

      await syncServerSession(session);
      setActiveSession(session ?? null);

      if (!session?.user) {
        await hydrateFromServerFallback();
        return;
      }

      hydrateStateFromUser(session.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleSetPassword = async () => {
    const normalizedName = fullName.trim();
    const normalizedPhone = phone.trim();

    if (!normalizedName) {
      toast.error("Ad Soyad zorunludur.");
      return;
    }

    if (password.length < 8) {
      toast.error("Şifre en az 8 karakter olmalı.");
      return;
    }

    if (password !== passwordConfirm) {
      toast.error("Şifreler eşleşmiyor.");
      return;
    }

    setSettingPassword(true);
    try {
      await saveLegacyProfile({
        fullName: normalizedName,
        phone: normalizedPhone,
        password,
      });

      if (currentUser?.email) {
        const renewedSession = await ensureFreshSessionAfterPasswordSet({
          email: currentUser.email,
          password,
        });
        if (renewedSession) {
          setActiveSession(renewedSession);
        }
        // If renewedSession is null the existing activeSession access token is
        // still valid for the store-creation step (access tokens remain usable
        // even after a password-change revokes the refresh token).
      }

      setPasswordSet(true);
      setCurrentStep(2);
      setPassword("");
      setPasswordConfirm("");
      const refreshed = await resolveStableSession();
      setCurrentUser(refreshed?.user ?? currentUser);
      toast.success("Şifre oluşturuldu. Şimdi mağaza kurulumunu tamamlayın.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Şifre oluşturulamadı.";
      toast.error(message);
    } finally {
      setSettingPassword(false);
    }
  };

  const handleCreateStoreAndBindSubscription = async () => {
    if (!passwordSet) {
      toast.error("Önce şifre adımını tamamlayın.");
      setCurrentStep(1);
      return;
    }

    const normalizedName = fullName.trim();
    const normalizedPhone = phone.trim();
    if (!normalizedName) {
      toast.error("Ad Soyad zorunludur.");
      return;
    }

    const normalizedStoreName = storeName.trim();
    if (!normalizedStoreName) {
      toast.error("Mağaza adı zorunludur.");
      return;
    }

    const categoryName = resolvedSubCategory?.name || selectedParentCategory?.name || "Genel";
    const topCategoryId =
      (selectedParentCategory?.dbId && selectedParentCategory.dbId.trim()) ||
      (selectedParentCategory?.id && selectedParentCategory.id.trim()) ||
      null;
    const subCategoryId = (resolvedSubCategory?.id && resolvedSubCategory.id.trim()) || null;

    setCreatingStore(true);
    try {
      const session = await getFreshAuthorizedSession();

      if (!session?.access_token) {
        throw new Error("Oturum bulunamadı. Tekrar giriş yapın.");
      }

      await syncServerSession(session);

      await saveLegacyProfile({
        fullName: normalizedName,
        phone: normalizedPhone,
      });

      const response = await fetch("/api/onboarding/store", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: "include",
        body: JSON.stringify({
          storeName: normalizedStoreName,
          phone: normalizedPhone || null,
          category: categoryName,
          topCategoryId,
          subCategoryId,
          currency: storeCurrency,
          priceCents: 4990,
          fallbackStoreNamePrefix: "Magazam",
          legacyLinkProSubscription: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
      };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Mağaza oluşturulamadı.");
      }

      toast.success("Mağaza oluşturuldu ve Pro abonelik mağazaya bağlandı.");
      router.replace("/etsy-automation");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kurulum tamamlanamadı.";
      toast.error(message);
    } finally {
      setCreatingStore(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07090f]">
        <div className="flex items-center gap-3 text-slate-200">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
          <span className="text-sm font-bold">Kurulum hazırlanıyor...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07090f] px-4">
        <Card className="w-full max-w-xl border-white/10 bg-[#0d111b]/95 text-white shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl font-black">Oturum Doğrulanamadı</CardTitle>
            <CardDescription className="text-slate-400">
              {sessionResolveError ?? "Magic link doğrulanamadı. Lütfen bağlantıyı yeniden açın."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end">
            <Button type="button" className="cursor-pointer" onClick={() => window.location.reload()}>
              Tekrar Dene
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090f] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-white/10 bg-[#0d111b]/95 text-white shadow-2xl">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_25px_rgba(79,70,229,0.35)]">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-black tracking-tight">Legacy Kullanıcı Kurulumu</CardTitle>
                <CardDescription className="text-slate-400">
                  Güvenlik ve mağaza bilgilerini tamamlayıp Pro aboneliğini mağazanıza bağlayın.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/3 p-2">
              <div
                className={`rounded-xl px-3 py-2 text-center text-xs font-black tracking-wide ${
                  currentStep === 1 ? "bg-indigo-600 text-white" : "bg-white/3 text-slate-400"
                }`}
              >
                1. Profil ve Şifre
              </div>
              <div
                className={`rounded-xl px-3 py-2 text-center text-xs font-black tracking-wide ${
                  currentStep === 2 ? "bg-indigo-600 text-white" : "bg-white/3 text-slate-400"
                }`}
              >
                2. Mağaza Kurulumu
              </div>
            </div>

            {currentStep === 1 ? (
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/2 p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-300" />
                  <p className="text-sm font-black">Adım 1: Şifre ve Profil</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      E-posta
                    </label>
                    <Input value={currentUser.email ?? ""} readOnly disabled />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Ad Soyad
                    </label>
                    <Input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Ad Soyad"
                      disabled={settingPassword}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Telefon (Opsiyonel)
                    </label>
                    <Input
                      value={phone}
                      onChange={(event) => setPhone(sanitizePhoneInput(event.target.value))}
                      inputMode="tel"
                      placeholder="+90 ..."
                      disabled={settingPassword}
                    />
                  </div>

                  {!passwordSet ? (
                    <>
                      <div>
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                          Şifre
                        </label>
                        <Input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="En az 8 karakter"
                          disabled={settingPassword}
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                          Şifre Tekrar
                        </label>
                        <Input
                          type="password"
                          value={passwordConfirm}
                          onChange={(event) => setPasswordConfirm(event.target.value)}
                          placeholder="Şifreyi tekrar girin"
                          disabled={settingPassword}
                        />
                      </div>
                    </>
                  ) : null}
                </div>

                {!passwordSet ? (
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => void handleSetPassword()} disabled={settingPassword}>
                      {settingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Şifreyi Oluştur ve Devam Et
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-emerald-300">Şifre adımı zaten tamamlanmış.</p>
                    <Button type="button" onClick={() => setCurrentStep(2)}>
                      Mağaza Adımına Geç
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/2 p-5">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-indigo-300" />
                  <p className="text-sm font-black">Adım 2: Mağaza Kurulumu ve Pro Abonelik Bağlama</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Mağaza Adı
                    </label>
                    <Input
                      value={storeName}
                      onChange={(event) => setStoreName(event.target.value)}
                      placeholder="Örn: MyEtsyStore"
                      disabled={creatingStore}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Ana Kategori
                    </label>
                    <Select
                      value={selectedParentCategoryId}
                      onChange={(event) => setSelectedParentCategoryId(event.target.value)}
                      disabled={creatingStore}
                    >
                      {topCategories.length === 0 ? (
                        <option value="" disabled>Kategori bulunamadı</option>
                      ) : null}
                      {topCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Alt Kategori
                    </label>
                    <Select
                      value={availableSubCategories.length ? selectedSubCategoryId : ""}
                      onChange={(event) => setSelectedSubCategoryId(event.target.value)}
                      disabled={creatingStore || !availableSubCategories.length}
                    >
                      {availableSubCategories.length ? (
                        <option value={LISTFLOW_DECIDE_VALUE}>Listflow karar versin</option>
                      ) : (
                        <option value="" disabled>Seçili ana kategori için alt kategori yok</option>
                      )}
                      {availableSubCategories.map((subcategory) => (
                        <option key={subcategory.id} value={subcategory.id}>
                          {subcategory.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="sm:col-span-2 rounded-xl border border-white/10 p-2">
                    <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Mağaza Para Birimi
                    </p>
                    <div className="inline-flex rounded-full border border-indigo-500/30 bg-white/5 p-1">
                      <button
                        type="button"
                        onClick={() => setStoreCurrency("USD")}
                        disabled={creatingStore}
                        className={`rounded-full px-4 py-2 text-xs font-black transition-all cursor-pointer ${
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
                        disabled={creatingStore}
                        className={`rounded-full px-4 py-2 text-xs font-black transition-all cursor-pointer ${
                          storeCurrency === "TRY"
                            ? "bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.35)]"
                            : "text-slate-300 hover:text-white"
                        }`}
                      >
                        ₺ Türk Lirası
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-xs text-indigo-200">
                  Bu kurulum tamamlandığında mağaza aboneliği otomatik olarak <span className="font-black">Pro</span> planına bağlanır.
                </div>

                <div className="flex justify-between gap-3">
                  <Button type="button" variant="secondary" onClick={() => setCurrentStep(1)} disabled={creatingStore}>
                    Geri
                  </Button>
                  <Button type="button" onClick={() => void handleCreateStoreAndBindSubscription()} disabled={creatingStore}>
                    {creatingStore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Mağazayı Oluştur ve Devam Et
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
