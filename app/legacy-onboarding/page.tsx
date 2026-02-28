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
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { supabase } from "@/lib/supabaseClient";

type StoreCurrency = "USD" | "TRY";
type LegacyOnboardingStep = 1 | 2;

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

  await fetch("/api/auth/session", { method: "DELETE" });
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
    const response = await fetch("/api/legacy-onboarding/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    const bootstrap = async () => {
      try {
        const session = await resolveStableSession();

        await syncServerSession(session);

        if (!active) {
          return;
        }

        if (!session?.user) {
          router.replace("/login");
          return;
        }

        if (!isLegacyOnboardingRequired(session.user)) {
          router.replace("/categories");
          return;
        }

        const initialPasswordSet = isLegacyPasswordSet(session.user);
        setCurrentUser(session.user);
        setPasswordSet(initialPasswordSet);
        setCurrentStep(initialPasswordSet ? 2 : 1);

        const metadata = getUserMetadata(session.user);
        const incomingName =
          typeof metadata.full_name === "string"
            ? metadata.full_name
            : typeof session.user.user_metadata?.full_name === "string"
              ? (session.user.user_metadata.full_name as string)
              : "";
        const incomingPhone = typeof metadata.phone === "string" ? metadata.phone : "";

        setFullName(incomingName);
        setPhone(incomingPhone);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Onboarding başlatılamadı.";
        toast.error(message);
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

      if (!session?.user) {
        router.replace("/login");
        return;
      }

      if (!isLegacyOnboardingRequired(session.user)) {
        router.replace("/categories");
        return;
      }

      const nextPasswordSet = isLegacyPasswordSet(session.user);
      setCurrentUser(session.user);
      setPasswordSet(nextPasswordSet);
      setCurrentStep(nextPasswordSet ? 2 : 1);
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
      const session = await resolveStableSession();

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
        headers: { "Content-Type": "application/json" },
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
    return null;
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
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
              <div
                className={`rounded-xl px-3 py-2 text-center text-xs font-black tracking-wide ${
                  currentStep === 1 ? "bg-indigo-600 text-white" : "bg-white/[0.03] text-slate-400"
                }`}
              >
                1. Profil ve Şifre
              </div>
              <div
                className={`rounded-xl px-3 py-2 text-center text-xs font-black tracking-wide ${
                  currentStep === 2 ? "bg-indigo-600 text-white" : "bg-white/[0.03] text-slate-400"
                }`}
              >
                2. Mağaza Kurulumu
              </div>
            </div>

            {currentStep === 1 ? (
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
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
                      onChange={(event) => setPhone(event.target.value)}
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
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
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
