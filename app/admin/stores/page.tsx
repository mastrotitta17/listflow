"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Check, Copy, Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizePhoneInput } from "@/lib/phone";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { toast } from "sonner";

type LastTrigger = {
  status: string | null;
  triggerType: string | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string | null;
  webhookConfigId: string | null;
};

type AutomationOverviewRow = {
  storeId: string;
  storeName: string;
  storeStatus: string;
  category: string | null;
  storeCurrency: "USD" | "TRY";
  storeCurrencyKnown?: boolean;
  productId: string | null;
  productLabel: string | null;
  eligibleWebhookConfigIds: string[];
  userId: string;
  userLabel: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
  monthIndex: number;
  canSwitch: boolean;
  minMonthRequired: number;
  eligibilityReason: string | null;
  activeWebhookConfigId: string | null;
  activeWebhookName: string | null;
  automationUpdatedAt: string | null;
  cadenceHours: number | null;
  nextTriggerAt: string | null;
  lastTrigger: LastTrigger | null;
  listingCount?: number;
};

type WebhookOption = {
  id: string;
  name: string;
  description: string | null;
  targetUrl: string;
  method: string | null;
  enabled: boolean;
  productId: string | null;
  currency: "USD" | "TRY" | null;
  productLabel?: string | null;
};

type AutomationOverviewResponse = {
  rows?: AutomationOverviewRow[];
  webhookOptions?: WebhookOption[];
  error?: string;
};

type SwitchResponse = {
  success?: boolean;
  code?: string;
  message?: string;
  error?: string;
};

type TableRow = AutomationOverviewRow & {
  selectedWebhookConfigId: string;
  availableWebhookOptions: WebhookOption[];
};

type AdminUserRow = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
};

type AdminUsersResponse = {
  rows?: AdminUserRow[];
  warning?: string;
  error?: string;
};

type PublicSubCategory = {
  id: string;
  name: string;
};

type PublicCategory = {
  id: string;
  dbId?: string;
  name: string;
  subProducts?: PublicSubCategory[];
};

type CategoriesResponse = {
  categories?: PublicCategory[];
  error?: string;
};

type ListingDetailRow = Record<string, unknown> & {
  id?: string;
  key?: string | null;
  title?: string | null;
  description?: string | null;
  tags?: unknown;
  price?: number | string | null;
  derived_status?: string;
  is_uploaded?: boolean;
  etsy_listing_id?: string | null;
  derived_listing_url?: string | null;
  derived_client_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ListingsResponse = {
  rows?: ListingDetailRow[];
  total?: number;
  error?: string;
};

type CreateStoreForUserResponse = {
  id?: string;
  storeName?: string;
  grantedPlan?: "standard" | "pro" | "turbo" | null;
  grantedSubscriptionId?: string | null;
  stripeSubscriptionId?: string | null;
  nextChargeAt?: string | null;
  error?: string;
};

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  pro: "Pro",
  turbo: "Turbo",
};
type EditablePlan = "standard" | "pro" | "turbo";
const LISTFLOW_DECIDE_VALUE = "__listflow_decide__";
const resolveEditablePlan = (value: string | null | undefined): EditablePlan => {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "pro" || normalized === "turbo") {
    return normalized;
  }
  return "standard";
};

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseListingTags = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [] as string[];
  }

  const raw = value.trim();
  if (!raw) {
    return [] as string[];
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      // Fallback to comma split
    }
  }

  return raw
    .split(",")
    .map((item) => item.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
};

const collectListingImages = (row: ListingDetailRow) => {
  const candidates = [
    row.image_1_url,
    row.image_2_url,
    row.image_3_url,
    row.image_1,
    row.image_2,
    row.image_3,
    row.image_url,
    row.main_image_url,
  ];

  const deduped = Array.from(
    new Set(
      candidates
        .map((candidate) => asText(candidate))
        .filter((candidate) => candidate.startsWith("http://") || candidate.startsWith("https://") || candidate.startsWith("data:image/"))
    )
  );

  return deduped;
};

const formatListingPrice = (value: unknown, currency: "USD" | "TRY") => {
  const numeric = typeof value === "number" ? value : Number(asText(value));
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${currency === "TRY" ? "₺" : "$"}${numeric}`;
  }
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("tr-TR");
};

const getWebhookCurrencyLabel = (currency: WebhookOption["currency"]) => {
  if (currency === "TRY") {
    return "TRY";
  }
  if (currency === "USD") {
    return "USD";
  }
  return "GENERIC";
};

const buildWebhookOptionLabel = (option: WebhookOption) => {
  const webhookName = (option.name ?? "").trim();
  const productLabel = (option.productLabel ?? "").trim();
  const isDuplicateProductLabel =
    Boolean(webhookName) &&
    Boolean(productLabel) &&
    webhookName.localeCompare(productLabel, "tr", { sensitivity: "base" }) === 0;

  const parts = [webhookName || productLabel || "Webhook"];
  if (productLabel && !isDuplicateProductLabel) {
    parts.push(productLabel);
  }
  parts.push(getWebhookCurrencyLabel(option.currency));

  return parts.join(" · ");
};

const formatCountdown = (targetIso: string | null | undefined, nowMs: number) => {
  if (!targetIso) {
    return "-";
  }

  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) {
    return "-";
  }

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return "Şimdi";
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}g ${String(hours).padStart(2, "0")}s ${String(minutes).padStart(2, "0")}d ${String(seconds).padStart(2, "0")}sn`;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

type NextTriggerCountdownProps = {
  hasSubscription: boolean;
  targetIso: string | null;
  cadenceHours: number | null;
};

function NextTriggerCountdown({ hasSubscription, targetIso, cadenceHours }: NextTriggerCountdownProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (!hasSubscription) {
    return <span className="text-xs text-slate-500">Aktif abonelik yok</span>;
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-black text-white">{formatCountdown(targetIso, nowMs)}</p>
      <p className="text-xs text-slate-500">
        {targetIso ? formatDate(targetIso) : "-"} {cadenceHours ? `(her ${cadenceHours} saat)` : ""}
      </p>
    </div>
  );
}

const getStatusVariant = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "active" || normalized === "success" || normalized === "paid" || normalized === "trialing") {
    return "success" as const;
  }

  if (normalized === "failed" || normalized === "canceled" || normalized === "unpaid") {
    return "destructive" as const;
  }

  if (normalized === "skipped" || normalized === "pending") {
    return "warning" as const;
  }

  return "secondary" as const;
};

const formatErrorMessage = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value === "no_active_webhook_config") {
    return "Aktif webhook atanmamış.";
  }

  if (value === "inactive_or_invalid_webhook_config") {
    return "Webhook pasif veya geçersiz.";
  }

  return value;
};

export default function AdminStoresPage() {
  const [rows, setRows] = useState<AutomationOverviewRow[]>([]);
  const [webhookOptions, setWebhookOptions] = useState<WebhookOption[]>([]);
  const [selectedWebhookByStore, setSelectedWebhookByStore] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [switchingStoreId, setSwitchingStoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [storeNameDraft, setStoreNameDraft] = useState("");
  const [storePhoneDraft, setStorePhoneDraft] = useState("");
  const [selectedParentCategoryId, setSelectedParentCategoryId] = useState("");
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState("");
  const [storeCurrency, setStoreCurrency] = useState<"USD" | "TRY">("USD");
  const [grantPlanDraft, setGrantPlanDraft] = useState<"none" | "starter" | "pro" | "turbo">("none");
  const [creatingStore, setCreatingStore] = useState(false);
  const [editStoreOpen, setEditStoreOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<AutomationOverviewRow | null>(null);
  const [editStoreNameDraft, setEditStoreNameDraft] = useState("");
  const [editStoreCurrencyDraft, setEditStoreCurrencyDraft] = useState<"USD" | "TRY">("USD");
  const [editStorePlanDraft, setEditStorePlanDraft] = useState<EditablePlan>("standard");
  const [savingStoreEdit, setSavingStoreEdit] = useState(false);
  const [listingViewerOpen, setListingViewerOpen] = useState(false);
  const [listingViewerStore, setListingViewerStore] = useState<AutomationOverviewRow | null>(null);
  const [listingViewerRows, setListingViewerRows] = useState<ListingDetailRow[]>([]);
  const [listingViewerTotal, setListingViewerTotal] = useState(0);
  const [listingViewerLoading, setListingViewerLoading] = useState(false);

  const webhookMap = useMemo(() => new Map(webhookOptions.map((item) => [item.id, item])), [webhookOptions]);
  const selectedParentCategory = useMemo(
    () => categories.find((category) => category.id === selectedParentCategoryId) ?? categories[0] ?? null,
    [categories, selectedParentCategoryId]
  );
  const availableSubCategories = useMemo(() => {
    if (!selectedParentCategory) {
      return [] as PublicSubCategory[];
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
  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) {
      return users;
    }

    return users.filter((user) => {
      const fullName = (user.full_name ?? "").toLowerCase();
      const email = (user.email ?? "").toLowerCase();
      const userId = (user.user_id ?? "").toLowerCase();
      return fullName.includes(needle) || email.includes(needle) || userId.includes(needle);
    });
  }, [users, userSearch]);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error);
  }, [error]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    toast.success(successMessage);
  }, [successMessage]);

  useEffect(() => {
    if (!usersError) {
      return;
    }

    toast.error(usersError);
  }, [usersError]);

  useEffect(() => {
    if (!categoriesError) {
      return;
    }

    toast.error(categoriesError);
  }, [categoriesError]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/stores/automation-overview", { cache: "no-store" });
      const payload = (await response.json()) as AutomationOverviewResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Automation overview yüklenemedi.");
      }

      const nextRows = payload.rows ?? [];
      const nextWebhookOptions = payload.webhookOptions ?? [];
      setRows(nextRows);
      setWebhookOptions(nextWebhookOptions);

      setSelectedWebhookByStore((prev) => {
        const next = { ...prev };

        for (const row of nextRows) {
          const eligibleWebhookIds = nextWebhookOptions
            .filter((option) => (row.eligibleWebhookConfigIds ?? []).includes(option.id))
            .map((option) => option.id);
          const selectedCurrent = next[row.storeId];
          const hasSelectedStillValid = eligibleWebhookIds.includes(selectedCurrent);
          const defaultTarget =
            row.activeWebhookConfigId && eligibleWebhookIds.includes(row.activeWebhookConfigId)
              ? row.activeWebhookConfigId
              : "";

          next[row.storeId] = hasSelectedStillValid ? selectedCurrent : defaultTarget;
        }

        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation overview yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = (await response.json()) as AdminUsersResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Kullanıcı listesi yüklenemedi.");
      }

      const sortedUsers = (payload.rows ?? []).sort((a, b) => {
        const left = (a.full_name || a.email || a.user_id || "").toLowerCase();
        const right = (b.full_name || b.email || b.user_id || "").toLowerCase();
        return left.localeCompare(right, "tr");
      });

      setUsers(sortedUsers);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Kullanıcı listesi yüklenemedi.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(null);

    try {
      const response = await fetch("/api/categories?locale=tr", { cache: "no-store" });
      const payload = (await response.json()) as CategoriesResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Kategoriler yüklenemedi.");
      }

      setCategories(payload.categories ?? []);
    } catch (err) {
      setCategoriesError(err instanceof Error ? err.message : "Kategoriler yüklenemedi.");
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userPickerOpen || users.length > 0 || usersLoading) {
      return;
    }

    void loadUsers();
  }, [userPickerOpen, users.length, usersLoading, loadUsers]);

  useEffect(() => {
    if (!createStoreOpen || categories.length > 0 || categoriesLoading) {
      return;
    }

    void loadCategories();
  }, [createStoreOpen, categories.length, categoriesLoading, loadCategories]);

  useEffect(() => {
    if (!selectedParentCategoryId && categories[0]) {
      setSelectedParentCategoryId(categories[0].id);
    }
  }, [selectedParentCategoryId, categories]);

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

  const resetCreateStoreForm = useCallback(() => {
    setStoreNameDraft("");
    setStorePhoneDraft("");
    setSelectedParentCategoryId(categories[0]?.id ?? "");
    setSelectedSubCategoryId(categories.length ? LISTFLOW_DECIDE_VALUE : "");
    setStoreCurrency("USD");
    setGrantPlanDraft("none");
  }, [categories]);

  const openCreateStoreModalForUser = useCallback(
    (user: AdminUserRow) => {
      setSelectedUser(user);
      setStoreNameDraft("");
      setStorePhoneDraft((user.phone ?? "").trim());
      setSelectedParentCategoryId(categories[0]?.id ?? "");
      setSelectedSubCategoryId(categories.length ? LISTFLOW_DECIDE_VALUE : "");
      setStoreCurrency("USD");
      setGrantPlanDraft("none");
      setCategoriesError(null);
      setUserPickerOpen(false);
      setCreateStoreOpen(true);
      setError(null);
      setSuccessMessage(null);
      if (!categories.length) {
        void loadCategories();
      }
    },
    [categories, loadCategories]
  );

  const handleCreateStoreForUser = useCallback(async () => {
    if (!selectedUser) {
      setError("Önce kullanıcı seçmelisin.");
      return;
    }

    const normalizedStoreName = normalizeStoreNameInput(storeNameDraft);
    const normalizedPhone = storePhoneDraft.trim();

    const categoryName = resolvedSubCategory?.name || selectedParentCategory?.name || "Genel";
    const topCategoryId =
      (selectedParentCategory?.dbId && selectedParentCategory.dbId.trim()) ||
      (selectedParentCategory?.id && selectedParentCategory.id.trim()) ||
      null;
    const subCategoryId = (resolvedSubCategory?.id && resolvedSubCategory.id.trim()) || null;

    setCreatingStore(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/admin/stores/create-for-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.user_id,
          storeName: normalizedStoreName || null,
          phone: normalizedPhone || null,
          category: categoryName,
          topCategoryId,
          subCategoryId,
          currency: storeCurrency,
          priceCents: 2990,
          grantPlan: grantPlanDraft === "none" ? null : grantPlanDraft,
          fallbackStoreNamePrefix: "Mağaza",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as CreateStoreForUserResponse;
      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Mağaza eklenemedi.");
      }

      const grantedPlanLabel = payload.grantedPlan ? PLAN_LABELS[payload.grantedPlan] ?? payload.grantedPlan : null;
      const storeLabel = payload.storeName || "yeni mağaza";
      const userLabel = selectedUser.full_name || selectedUser.email || selectedUser.user_id;
      setSuccessMessage(
        grantedPlanLabel
          ? `${userLabel} kullanıcısına ${storeLabel} eklendi. ${grantedPlanLabel} planı Stripe ile bağlandı, ilk dönem ücretsiz; sonraki dönem otomatik tahsil edilecek.`
          : `${userLabel} kullanıcısına ${storeLabel} eklendi.`
      );
      setCreateStoreOpen(false);
      setSelectedUser(null);
      resetCreateStoreForm();
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mağaza eklenemedi.");
    } finally {
      setCreatingStore(false);
    }
  }, [
    loadOverview,
    resetCreateStoreForm,
    resolvedSubCategory,
    selectedParentCategory,
    selectedUser,
    grantPlanDraft,
    storeCurrency,
    storeNameDraft,
    storePhoneDraft,
  ]);

  const openEditStoreModal = useCallback((store: AutomationOverviewRow) => {
    const resolvedPlan = resolveEditablePlan(store.plan);
    setEditingStore(store);
    setEditStoreNameDraft(store.storeName || "");
    setEditStoreCurrencyDraft(store.storeCurrency === "TRY" ? "TRY" : "USD");
    setEditStorePlanDraft(resolvedPlan);
    setEditStoreOpen(true);
    setError(null);
    setSuccessMessage(null);
  }, []);

  const handleSaveStoreEdit = useCallback(async () => {
    if (!editingStore) {
      return;
    }

    const normalizedStoreName = normalizeStoreNameInput(editStoreNameDraft);
    if (!normalizedStoreName) {
      setError("Mağaza adı boş olamaz.");
      return;
    }

    const currentStoreName = normalizeStoreNameInput(editingStore.storeName || "");
    const currentCurrency = editingStore.storeCurrency === "TRY" ? "TRY" : "USD";
    const currentPlan = resolveEditablePlan(editingStore.plan);
    const hasSubscription = Boolean(editingStore.subscriptionId);
    const changedStoreName = normalizedStoreName !== currentStoreName;
    const changedCurrency = editStoreCurrencyDraft !== currentCurrency;
    const changedPlan = hasSubscription && editStorePlanDraft !== currentPlan;
    const noChanges = !changedStoreName && !changedCurrency && !changedPlan;

    if (noChanges) {
      setSuccessMessage("Kaydedilecek bir değişiklik bulunamadı.");
      setEditStoreOpen(false);
      setEditingStore(null);
      setEditStoreNameDraft("");
      setEditStoreCurrencyDraft("USD");
      setEditStorePlanDraft("standard");
      return;
    }

    setSavingStoreEdit(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const encodedStoreId = encodeURIComponent(editingStore.storeId);
      const patchPayload: Record<string, unknown> = {};
      if (changedStoreName) {
        patchPayload.store_name = normalizedStoreName;
      }
      if (changedCurrency) {
        patchPayload.store_currency = editStoreCurrencyDraft;
      }
      if (changedPlan) {
        patchPayload.plan = editStorePlanDraft;
      }

      const response = await fetch(`/api/admin/stores/${encodedStoreId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchPayload),
      });

      const rawBody = await response.text();
      let payload: { error?: string } = {};
      if (rawBody.trim()) {
        try {
          payload = JSON.parse(rawBody) as { error?: string };
        } catch {
          payload = { error: rawBody };
        }
      }

      if (!response.ok) {
        throw new Error(payload.error || `Mağaza güncellenemedi (HTTP ${response.status}).`);
      }

      const changeLabels: string[] = [];
      if (changedStoreName) changeLabels.push(`isim: ${normalizedStoreName}`);
      if (changedCurrency) changeLabels.push(`para birimi: ${editStoreCurrencyDraft}`);
      if (changedPlan) changeLabels.push(`plan: ${PLAN_LABELS[editStorePlanDraft]}`);
      setSuccessMessage(`${editingStore.storeName} mağazası güncellendi (${changeLabels.join(", ")}).`);
      setEditStoreOpen(false);
      setEditingStore(null);
      setEditStoreNameDraft("");
      setEditStoreCurrencyDraft("USD");
      setEditStorePlanDraft("standard");
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mağaza güncellenemedi.");
    } finally {
      setSavingStoreEdit(false);
    }
  }, [editStoreCurrencyDraft, editStoreNameDraft, editStorePlanDraft, editingStore, loadOverview]);

  const openListingViewer = useCallback(async (store: AutomationOverviewRow) => {
    setListingViewerStore(store);
    setListingViewerOpen(true);
    setListingViewerLoading(true);
    setListingViewerRows([]);
    setListingViewerTotal(0);
    setError(null);

    try {
      const params = new URLSearchParams({
        status: "all",
        client_id: store.storeId,
        limit: "500",
        offset: "0",
      });

      const response = await fetch(`/api/admin/listings?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ListingsResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Listing verileri yüklenemedi.");
      }

      setListingViewerRows(payload.rows ?? []);
      setListingViewerTotal(typeof payload.total === "number" ? payload.total : (payload.rows ?? []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Listing verileri yüklenemedi.");
    } finally {
      setListingViewerLoading(false);
    }
  }, []);

  const runSwitch = useCallback(
    async (store: TableRow) => {
      const rowWithSelection = store as TableRow;
      const targetWebhookConfigId = rowWithSelection.selectedWebhookConfigId ?? selectedWebhookByStore[store.storeId];

      if (!targetWebhookConfigId) {
        setError("Önce hedef webhook seçmelisin.");
        return;
      }

      const isTargetVisibleForStore = rowWithSelection.availableWebhookOptions.some(
        (option) => option.id === targetWebhookConfigId
      );
      if (!isTargetVisibleForStore) {
        setError("Seçilen webhook bu mağaza için uygun değil. Lütfen listeden tekrar seç.");
        return;
      }

      setSwitchingStoreId(store.storeId);
      setError(null);
      setSuccessMessage(null);

      try {
        const encodedStoreId = encodeURIComponent(store.storeId);
        const response = await fetch(`/api/admin/stores/${encodedStoreId}/automation-switch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetWebhookConfigId }),
        });

        const rawBody = await response.text();
        let payload: SwitchResponse = {};
        if (rawBody.trim()) {
          try {
            payload = JSON.parse(rawBody) as SwitchResponse;
          } catch {
            payload = { error: rawBody };
          }
        }

        if (!response.ok) {
          throw new Error(
            payload.message ||
              payload.error ||
              `Geçiş işlemi başarısız (HTTP ${response.status}).`
          );
        }

        const webhookName = webhookMap.get(targetWebhookConfigId)?.name ?? "hedef webhook";
        setSuccessMessage(`${store.storeName} için ${webhookName} otomasyonu tetiklendi.`);
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Geçiş işlemi başarısız.");
      } finally {
        setSwitchingStoreId(null);
      }
    },
    [loadOverview, selectedWebhookByStore, webhookMap]
  );

  const tableRows = useMemo<TableRow[]>(() => {
    return rows.map((row) => {
      const eligibleIds = row.eligibleWebhookConfigIds ?? [];
      const fallbackOptions = webhookOptions.filter((option) => eligibleIds.includes(option.id));

      const selectedCurrent = selectedWebhookByStore[row.storeId] ?? "";
      const selectedWebhookConfigId = fallbackOptions.some((option) => option.id === selectedCurrent)
        ? selectedCurrent
        : fallbackOptions[0]?.id ?? "";

      return {
        ...row,
        selectedWebhookConfigId,
        availableWebhookOptions: fallbackOptions,
      };
    });
  }, [rows, selectedWebhookByStore, webhookOptions]);

  const handleCopyStoreId = useCallback(async (storeId: string) => {
    try {
      await navigator.clipboard.writeText(storeId);
      setCopiedStoreId(storeId);
      window.setTimeout(() => {
        setCopiedStoreId((prev) => (prev === storeId ? null : prev));
      }, 1200);
    } catch {
      // no-op
    }
  }, []);

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        accessorKey: "storeName",
        header: "Mağaza",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="rounded bg-white/5 px-2 py-1 text-[11px] font-black text-indigo-200">{item.storeId}</code>
                <button
                  type="button"
                  onClick={() => void handleCopyStoreId(item.storeId)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-white/5 text-slate-300 hover:text-white cursor-pointer"
                  title="Store ID kopyala"
                >
                  {copiedStoreId === item.storeId ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="font-black text-white">{item.storeName}</p>
              <div className="flex items-center gap-2">
                <Badge variant={getStatusVariant(item.storeStatus)}>{item.storeStatus}</Badge>
                <Badge variant="secondary">{item.storeCurrency === "TRY" ? "TRY" : "USD"}</Badge>
                <span className="text-xs text-slate-500">{item.category || "-"}</span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "userLabel",
        header: "Kullanıcı",
      },
      {
        accessorKey: "listingCount",
        header: "Listing",
        cell: ({ row }) => {
          const item = row.original;
          const count = item.listingCount ?? 0;
          return (
            <button
              type="button"
              onClick={() => void openListingViewer(item)}
              className={`text-sm font-black cursor-pointer underline-offset-2 hover:underline ${
                count > 0 ? "text-emerald-400" : "text-slate-500"
              }`}
              title={`${item.storeName} listinglerini göster`}
            >
              {count}
            </button>
          );
        },
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <Badge variant={getStatusVariant(item.subscriptionStatus)}>{item.subscriptionStatus || "-"}</Badge>
              <p className="text-xs text-slate-400">{item.plan ? PLAN_LABELS[item.plan] ?? item.plan : "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "monthIndex",
        header: "Ay",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <p className="text-sm font-black text-white">{item.monthIndex}. Ay</p>
              <p className="text-xs text-slate-500">Dönem sonu: {formatDate(item.currentPeriodEnd)}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "activeWebhookName",
        header: "Mevcut Otomasyon",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <p className="text-xs text-slate-200">{item.activeWebhookName || "-"}</p>
              <p className="text-xs text-slate-500">Güncelleme: {formatDate(item.automationUpdatedAt)}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "lastTrigger",
        header: "Son Tetik",
        cell: ({ row }) => {
          const trigger = row.original.lastTrigger;
          const triggerWebhookName = trigger?.webhookConfigId
            ? webhookMap.get(trigger.webhookConfigId)?.name ?? trigger.webhookConfigId
            : null;

          if (!trigger) {
            return <span className="text-xs text-slate-500">Henüz job yok</span>;
          }

          return (
            <div className="space-y-1">
              <Badge variant={getStatusVariant(trigger.status)}>
                {trigger.triggerType || "scheduled"} / {trigger.status || "-"}
              </Badge>
              <p className="text-xs text-slate-500">
                HTTP {trigger.responseStatus ?? "-"} - {formatDate(trigger.createdAt)}
              </p>
              {triggerWebhookName ? <p className="text-xs text-slate-400">{triggerWebhookName}</p> : null}
              {trigger.errorMessage ? <p className="text-xs text-red-300">{formatErrorMessage(trigger.errorMessage)}</p> : null}
            </div>
          );
        },
      },
      {
        accessorKey: "nextTriggerAt",
        header: "Sonraki Tetik",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <NextTriggerCountdown
              hasSubscription={Boolean(item.subscriptionId)}
              targetIso={item.nextTriggerAt}
              cadenceHours={item.cadenceHours}
            />
          );
        },
      },
      {
        id: "switchTarget",
        header: "Hedef Geçiş",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <Select
              value={item.selectedWebhookConfigId}
              onChange={(event) =>
                setSelectedWebhookByStore((prev) => ({
                  ...prev,
                  [item.storeId]: event.target.value,
                }))
              }
              className="min-w-[13rem] w-full"
              searchPlaceholder="Webhook ara..."
            >
              <option value="">Webhook seçin</option>
              {item.availableWebhookOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {buildWebhookOptionLabel(option)}
                </option>
              ))}
            </Select>
          );
        },
      },
      {
        id: "actions",
        header: "Aksiyon",
        cell: ({ row }) => {
          const item = row.original;
          const selectedWebhook = item.availableWebhookOptions.find((option) => option.id === item.selectedWebhookConfigId) ?? null;
          const switchDisabled =
            !item.canSwitch ||
            !item.selectedWebhookConfigId ||
            switchingStoreId === item.storeId;

          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void runSwitch(item)}
                  disabled={switchDisabled}
                  size="icon"
                  className="cursor-pointer"
                  title={
                    switchingStoreId === item.storeId
                      ? "Geçiş yapılıyor..."
                      : `${selectedWebhook?.name || "Webhook"} hedefine geçir`
                  }
                  aria-label="Webhooka geçir"
                >
                  {switchingStoreId === item.storeId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="cursor-pointer"
                  onClick={() => openEditStoreModal(item)}
                  disabled={savingStoreEdit}
                  title="Mağazayı düzenle"
                  aria-label="Mağazayı düzenle"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              {selectedWebhook ? (
                <p className="text-xs text-slate-400 truncate" title={selectedWebhook.name}>
                  {selectedWebhook.name}
                </p>
              ) : null}
              {!item.selectedWebhookConfigId ? (
                <p className="text-xs text-amber-300">
                  {item.storeCurrency} para birimi için uygun webhook bulunamadı.
                </p>
              ) : null}
              {!item.subscriptionId ? <p className="text-xs text-amber-300">Aktif abonelik yok.</p> : null}
            </div>
          );
        },
      },
    ],
    [
      openEditStoreModal,
      openListingViewer,
      runSwitch,
      switchingStoreId,
      copiedStoreId,
      handleCopyStoreId,
      savingStoreEdit,
      webhookMap,
    ]
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <Badge className="w-fit">Stores Automation</Badge>
          <CardTitle>Mağaza Otomasyon Orkestrasyonu</CardTitle>
          <CardDescription>
            Store bazlı n8n webhook yönetimi. Webhook seçip geçir butonu{" "}
            <span className="text-indigo-300 font-mono">{`{ client_id: store_id }`}</span> payload&apos;ı ile anında tetikler.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <Button
              className="cursor-pointer w-full sm:w-auto"
              onClick={() => {
                setUsersError(null);
                setUserSearch("");
                setUserPickerOpen(true);
                if (!users.length) {
                  void loadUsers();
                }
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Mağaza Ekle
            </Button>
            <Button
              variant="secondary"
              className="cursor-pointer w-full sm:w-auto"
              onClick={() => void loadOverview()}
              disabled={loading}
            >
              Yenile
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {successMessage ? (
            <Alert variant="success">
              <AlertTitle>Başarılı</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-2 sm:p-3">
              <DataTable
                columns={columns}
                data={tableRows}
                searchPlaceholder="Mağaza, kullanıcı, plan ara..."
                searchKeys={[
                  "storeName",
                  "storeId",
                  "userLabel",
                  "plan",
                  "subscriptionStatus",
                  "storeCurrency",
                  "category",
                  "activeWebhookName",
                ]}
                pageSize={8}
                statusFilterKey="storeStatus"
                dateFilterKey="automationUpdatedAt"
                statusFilterLabel="Mağaza Durumu"
                dateFilterLabel="Otomasyon Güncelleme"
                filtersInline
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={userPickerOpen}
        onOpenChange={(open) => {
          setUserPickerOpen(open);
          if (!open) {
            setUserSearch("");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Kullanıcı Seç</DialogTitle>
            <DialogDescription>
              Mağaza eklemek istediğin kullanıcıyı arayıp seç.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Ad, e-posta veya kullanıcı ID ara..."
            />

            {usersError ? (
              <Alert variant="destructive">
                <AlertTitle>Hata</AlertTitle>
                <AlertDescription>{usersError}</AlertDescription>
              </Alert>
            ) : null}

            {usersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {filteredUsers.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-sm text-slate-400">
                    Aramaya uygun kullanıcı bulunamadı.
                  </p>
                ) : (
                  filteredUsers.map((user) => (
                    <div
                      key={user.user_id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-sm font-black text-white">{user.full_name || "-"}</p>
                        <p className="truncate text-xs text-slate-400">{user.email || "-"}</p>
                        <p className="truncate text-[11px] text-slate-500">{user.user_id}</p>
                      </div>
                      <Button
                        className="shrink-0 cursor-pointer"
                        onClick={() => openCreateStoreModalForUser(user)}
                      >
                        Mağaza Ekle
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createStoreOpen}
        onOpenChange={(open) => {
          if (!open && creatingStore) {
            return;
          }

          setCreateStoreOpen(open);
          if (!open) {
            setSelectedUser(null);
            resetCreateStoreForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kullanıcıya Mağaza Ekle</DialogTitle>
            <DialogDescription>
              {selectedUser
                ? `${selectedUser.full_name || selectedUser.email || selectedUser.user_id} için mağaza oluştur`
                : "Önce kullanıcı seçmelisin."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Mağaza Adı</label>
                <Input
                  value={storeNameDraft}
                  onChange={(event) => setStoreNameDraft(event.target.value)}
                  onBlur={() => setStoreNameDraft((prev) => normalizeStoreNameInput(prev))}
                  placeholder="Örn: Elif Design Store"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Telefon No (Opsiyonel)</label>
                <Input
                  value={storePhoneDraft}
                  onChange={(event) => setStorePhoneDraft(sanitizePhoneInput(event.target.value))}
                  inputMode="tel"
                  placeholder="+90 5xx xxx xx xx"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Ana Kategori</label>
                <Select
                  value={selectedParentCategoryId}
                  onChange={(event) => setSelectedParentCategoryId(event.target.value)}
                  disabled={categoriesLoading || categories.length === 0}
                >
                  {categoriesLoading ? <option value="">Kategoriler yükleniyor...</option> : null}
                  {!categoriesLoading && categories.length === 0 ? <option value="">Kategori bulunamadı</option> : null}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Alt Kategori</label>
                <Select
                  value={availableSubCategories.length ? selectedSubCategoryId : ""}
                  onChange={(event) => setSelectedSubCategoryId(event.target.value)}
                  disabled={categoriesLoading || !availableSubCategories.length}
                >
                  {!availableSubCategories.length ? <option value="">Seçili ana kategori için alt kategori yok</option> : null}
                  {availableSubCategories.length ? (
                    <option value={LISTFLOW_DECIDE_VALUE}>Listflow karar versin ({availableSubCategories[0]?.name})</option>
                  ) : null}
                  {availableSubCategories.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.id}>
                      {subcategory.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {selectedSubCategoryId === LISTFLOW_DECIDE_VALUE && availableSubCategories.length ? (
              <p className="text-xs text-indigo-300">
                Varsayılan alt kategori seçimi: {availableSubCategories[0]?.name}
              </p>
            ) : null}

            <div className="space-y-2 border border-white/10 rounded-xl py-2 px-3 flex justify-between items-center w-full">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Atanacak Plan</label>
              <Select value={grantPlanDraft} onChange={(event) => setGrantPlanDraft(event.target.value as "none" | "starter" | "pro" | "turbo")}>
                <option value="none">Plan atama (yok)</option>
                <option value="starter">Starter (Stripe: ilk dönem ücretsiz)</option>
                <option value="pro">Pro (Stripe: ilk dönem ücretsiz)</option>
                <option value="turbo">Turbo (Stripe: ilk dönem ücretsiz)</option>
              </Select>
            </div>

            {grantPlanDraft !== "none" ? (
              <p className="text-xs text-emerald-300">
                Bu mağazaya {grantPlanDraft.toUpperCase()} planı Stripe aboneliğiyle bağlanır. Bu dönem ücretsiz başlar, sonraki dönemde otomatik tahsilat yapılır.
              </p>
            ) : null}

            <div className="space-y-2 border border-white/10 rounded-xl py-2 px-3 flex justify-between items-center w-full">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Mağaza Para Birimi</label>
              <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setStoreCurrency("USD")}
                  className={`min-w-[72px] rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                    storeCurrency === "USD" ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                >
                  $ Dolar
                </button>
                <button
                  type="button"
                  onClick={() => setStoreCurrency("TRY")}
                  className={`min-w-[72px] rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                    storeCurrency === "TRY" ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                >
                  ₺ TL
                </button>
              </div>
            </div>

            {categoriesError ? (
              <Alert variant="destructive">
                <AlertTitle>Hata</AlertTitle>
                <AlertDescription>{categoriesError}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                setCreateStoreOpen(false);
                setSelectedUser(null);
                resetCreateStoreForm();
              }}
              disabled={creatingStore}
            >
              İptal
            </Button>
            <Button
              className="cursor-pointer"
              onClick={() => void handleCreateStoreForUser()}
              disabled={creatingStore || categoriesLoading || !selectedUser}
            >
              {creatingStore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Mağaza Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={listingViewerOpen}
        onOpenChange={(open) => {
          setListingViewerOpen(open);
          if (!open) {
            setListingViewerStore(null);
            setListingViewerRows([]);
            setListingViewerTotal(0);
            setListingViewerLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Mağaza Listingleri</DialogTitle>
            <DialogDescription>
              {listingViewerStore
                ? `${listingViewerStore.storeName} (${listingViewerStore.storeId})`
                : "Mağaza seçimi yok"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <Badge variant="secondary">Store ID: {listingViewerStore?.storeId ?? "-"}</Badge>
              <Badge variant="secondary">Mağaza: {listingViewerStore?.storeName ?? "-"}</Badge>
              <Badge variant="secondary">Toplam Listing: {listingViewerTotal}</Badge>
            </div>

            {listingViewerLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : null}

            {!listingViewerLoading && listingViewerRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Bu mağaza için listing kaydı bulunamadı.
              </div>
            ) : null}

            {!listingViewerLoading && listingViewerRows.length > 0 ? (
              <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                {listingViewerRows.map((listing, index) => {
                  const images = collectListingImages(listing);
                  const tags = parseListingTags(listing.tags);
                  const listingClientId = asText(listing.derived_client_id || listing.client_id || listing.store_id) || "-";
                  const listingTitle = asText(listing.title) || "-";
                  const listingDescription = asText(listing.description) || "-";
                  const listingId = asText(listing.id || listing.key) || `row-${index}`;
                  const listingUrl = asText(listing.derived_listing_url);

                  return (
                    <div key={listingId} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                        <div className="space-y-2">
                          {images[0] ? (
                            <img
                              src={images[0]}
                              alt={listingTitle}
                              className="h-44 w-full rounded-xl object-cover border border-white/10"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-44 w-full rounded-xl border border-dashed border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-500">
                              Görsel yok
                            </div>
                          )}
                          {images.length > 1 ? (
                            <div className="grid grid-cols-3 gap-2">
                              {images.slice(1, 4).map((imageUrl) => (
                                <img
                                  key={`${listingId}-${imageUrl}`}
                                  src={imageUrl}
                                  alt={listingTitle}
                                  className="h-16 w-full rounded-lg object-cover border border-white/10"
                                  loading="lazy"
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="secondary">Client ID: {listingClientId}</Badge>
                            <Badge variant="secondary">Store ID: {listingViewerStore?.storeId ?? "-"}</Badge>
                            <Badge variant="secondary">Store Name: {listingViewerStore?.storeName ?? "-"}</Badge>
                            <Badge variant={Boolean(listing.is_uploaded) ? "success" : "destructive"}>
                              {Boolean(listing.is_uploaded) ? "Yüklendi" : "Yüklenmedi"}
                            </Badge>
                          </div>

                          <p className="text-sm font-black text-white">{listingTitle}</p>
                          <p className="text-xs text-slate-300 whitespace-pre-wrap">{listingDescription}</p>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                            <span>Fiyat: {formatListingPrice(listing.price, listingViewerStore?.storeCurrency ?? "USD")}</span>
                            <span>Durum: {asText(listing.derived_status || listing.status || listing.listing_status) || "-"}</span>
                            <span>Etsy ID: {asText(listing.etsy_listing_id) || "-"}</span>
                          </div>

                          {tags.length ? (
                            <div className="flex flex-wrap gap-1">
                              {tags.map((tag) => (
                                <Badge key={`${listingId}-${tag}`} variant="outline">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">Etiket yok</p>
                          )}

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span>Oluşturma: {formatDate(asText(listing.created_at) || null)}</span>
                            <span>Güncelleme: {formatDate(asText(listing.updated_at) || null)}</span>
                            {listingUrl ? (
                              <a
                                href={listingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-300 hover:underline"
                              >
                                Etsy URL Aç
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editStoreOpen}
        onOpenChange={(open) => {
          if (!open && savingStoreEdit) {
            return;
          }

          setEditStoreOpen(open);
          if (!open) {
            setEditingStore(null);
            setEditStoreNameDraft("");
            setEditStoreCurrencyDraft("USD");
            setEditStorePlanDraft("standard");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mağaza Düzenle</DialogTitle>
            <DialogDescription>
              {editingStore
                ? `${editingStore.storeId} için mağaza adı, para birimi ve abonelik planını güncelle`
                : "Düzenlenecek mağaza seçilmedi."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Mağaza Adı</label>
              <Input
                value={editStoreNameDraft}
                onChange={(event) => setEditStoreNameDraft(event.target.value)}
                onBlur={() => setEditStoreNameDraft((prev) => normalizeStoreNameInput(prev))}
                placeholder="Örn: OrmusWallClock"
                disabled={!editingStore || savingStoreEdit}
              />
              <p className="text-xs text-slate-500">Etsy linki girersen otomatik mağaza adı çıkarılır.</p>
            </div>

            <div className="space-y-2 border border-white/10 rounded-xl py-2 px-3 flex justify-between items-center w-full">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Mağaza Para Birimi</label>
              <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setEditStoreCurrencyDraft("USD")}
                  className={`min-w-[72px] rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                    editStoreCurrencyDraft === "USD" ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                  disabled={!editingStore || savingStoreEdit}
                >
                  $ Dolar
                </button>
                <button
                  type="button"
                  onClick={() => setEditStoreCurrencyDraft("TRY")}
                  className={`min-w-[72px] rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                    editStoreCurrencyDraft === "TRY" ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                  disabled={!editingStore || savingStoreEdit}
                >
                  ₺ TL
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Abonelik Planı</label>
              <Select
                value={editStorePlanDraft}
                onChange={(event) => setEditStorePlanDraft(event.target.value as EditablePlan)}
                disabled={!editingStore?.subscriptionId || savingStoreEdit}
              >
                <option value="standard">{PLAN_LABELS.standard}</option>
                <option value="pro">{PLAN_LABELS.pro}</option>
                <option value="turbo">{PLAN_LABELS.turbo}</option>
              </Select>
              {!editingStore?.subscriptionId ? (
                <p className="text-xs text-amber-300">Bu mağazada aktif subscription kaydı yok, plan değiştirilemez.</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                setEditStoreOpen(false);
                setEditingStore(null);
                setEditStoreNameDraft("");
                setEditStoreCurrencyDraft("USD");
                setEditStorePlanDraft("standard");
              }}
              disabled={savingStoreEdit}
            >
              Vazgeç
            </Button>
            <Button
              className="cursor-pointer"
              onClick={() => void handleSaveStoreEdit()}
              disabled={!editingStore || savingStoreEdit}
            >
              {savingStoreEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
