"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Rocket, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { sanitizePhoneInput } from "@/lib/phone";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { LegacyOnboardingSkeleton } from "@/components/loading/PageSkeletons";

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
const LEGACY_ONBOARDING_TOKEN_HEADER = "x-legacy-onboarding-token";

const buildLegacyHeaders = (onboardingToken: string | null) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (onboardingToken) {
    headers[LEGACY_ONBOARDING_TOKEN_HEADER] = onboardingToken;
  }
  return headers;
};

const buildLegacyApiUrl = (path: string, onboardingToken: string | null) => {
  const url = new URL(path, window.location.origin);
  if (onboardingToken) {
    url.searchParams.set("token", onboardingToken);
  }
  return `${url.pathname}${url.search}`;
};

const loadLegacyOnboardingUser = async (onboardingToken: string | null): Promise<LegacyBootstrapUser | null> => {
  const response = await fetch(buildLegacyApiUrl("/api/legacy-onboarding/profile", onboardingToken), {
    method: "GET",
    cache: "no-store",
    headers: buildLegacyHeaders(onboardingToken),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as {
    user?: LegacyBootstrapUser;
  };

  return payload.user ?? null;
};

export default function LegacyOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const { categories, loading: categoriesLoading } = useCategoriesRepository(locale);
  const onboardingToken = (searchParams.get("token") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<LegacyBootstrapUser | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
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
    const response = await fetch(buildLegacyApiUrl("/api/legacy-onboarding/profile", onboardingToken), {
      method: "POST",
      headers: buildLegacyHeaders(onboardingToken),
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
        const legacyUser = await loadLegacyOnboardingUser(onboardingToken || null);
        if (!active) {
          return;
        }

        if (!legacyUser) {
          setCurrentUser(null);
          setBootstrapError(
            onboardingToken
              ? "Onboarding bağlantısı geçersiz, süresi dolmuş veya zaten kullanılmış."
              : "Oturum doğrulanamadı. Lütfen yeniden giriş yapın veya onboarding linkini kullanın."
          );
          return;
        }

        setCurrentUser(legacyUser);
        setPasswordSet(legacyUser.legacyPasswordSet);
        setCurrentStep(legacyUser.legacyPasswordSet ? 2 : 1);
        setFullName(legacyUser.fullName ?? "");
        setPhone(legacyUser.phone ?? "");
        setBootstrapError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Onboarding başlatılamadı.";
        toast.error(message);
        setCurrentUser(null);
        setBootstrapError("Onboarding bağlantısı doğrulanamadı. Admin panelden yeni link üretin.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [onboardingToken]);


  if (loading || categoriesLoading) {
    return <LegacyOnboardingSkeleton />;
  }

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
      await saveLegacyProfile({
        fullName: normalizedName,
        phone: normalizedPhone,
      });

      const response = await fetch(buildLegacyApiUrl("/api/onboarding/store", onboardingToken), {
        method: "POST",
        headers: buildLegacyHeaders(onboardingToken),
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
      const nextUrl = currentUser?.email
        ? `/login?email=${encodeURIComponent(currentUser.email)}&legacyOnboarding=completed`
        : "/login?legacyOnboarding=completed";
      router.replace(nextUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kurulum tamamlanamadı.";
      toast.error(message);
    } finally {
      setCreatingStore(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#07090f] px-4">
        <div className="flex items-center gap-3 text-slate-200">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
          <span className="text-sm font-bold">Kurulum hazırlanıyor...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#07090f] px-4">
        <Card className="w-full max-w-xl border-white/10 bg-[#0d111b]/95 text-white shadow-2xl">
          <CardHeader className="space-y-2 p-5 sm:p-6">
            <CardTitle className="text-xl font-black">Bağlantı Doğrulanamadı</CardTitle>
            <CardDescription className="text-slate-400">
              {bootstrapError ?? "Onboarding bağlantısı doğrulanamadı. Lütfen yeni link kullanın."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end p-5 pt-0 sm:p-6 sm:pt-0">
            <Button type="button" className="cursor-pointer" onClick={() => window.location.reload()}>
              Tekrar Dene
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#07090f] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-white/10 bg-[#0d111b]/95 text-white shadow-2xl">
          <CardHeader className="space-y-3 p-5 sm:p-6">
            <div className="flex items-start gap-3 sm:items-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_25px_rgba(79,70,229,0.35)]">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-xl font-black tracking-tight sm:text-2xl">Legacy Kullanıcı Kurulumu</CardTitle>
                <CardDescription className="text-slate-400">
                  Güvenlik ve mağaza bilgilerini tamamlayıp Pro aboneliğini mağazanıza bağlayın.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-5 pt-0 sm:space-y-8 sm:p-6 sm:pt-0">
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
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button type="button" onClick={() => void handleSetPassword()} disabled={settingPassword}>
                      {settingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Şifreyi Oluştur ve Devam Et
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
