"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Plus } from "lucide-react";
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
};

type WebhookOption = {
  id: string;
  name: string;
  description: string | null;
  targetUrl: string;
  method: string | null;
  enabled: boolean;
  productId: string | null;
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

type CreateStoreForUserResponse = {
  id?: string;
  storeName?: string;
  error?: string;
};

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  pro: "Pro",
  turbo: "Turbo",
};
const LISTFLOW_DECIDE_VALUE = "__listflow_decide__";

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
  const [creatingStore, setCreatingStore] = useState(false);

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
          const eligibleWebhookIds = (row.eligibleWebhookConfigIds ?? []).filter((id) =>
            nextWebhookOptions.some((option) => option.id === id)
          );
          const selectedCurrent = next[row.storeId];
          const hasSelectedStillValid = eligibleWebhookIds.includes(selectedCurrent);
          const defaultTarget =
            row.activeWebhookConfigId && eligibleWebhookIds.includes(row.activeWebhookConfigId)
              ? row.activeWebhookConfigId
              : eligibleWebhookIds[0] ?? "";

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
  }, [categories]);

  const openCreateStoreModalForUser = useCallback(
    (user: AdminUserRow) => {
      setSelectedUser(user);
      setStoreNameDraft("");
      setStorePhoneDraft((user.phone ?? "").trim());
      setSelectedParentCategoryId(categories[0]?.id ?? "");
      setSelectedSubCategoryId(categories.length ? LISTFLOW_DECIDE_VALUE : "");
      setStoreCurrency("USD");
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
          storeName: storeNameDraft.trim() || null,
          phone: normalizedPhone || null,
          category: categoryName,
          topCategoryId,
          subCategoryId,
          currency: storeCurrency,
          priceCents: 2990,
          fallbackStoreNamePrefix: "Mağaza",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as CreateStoreForUserResponse;
      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Mağaza eklenemedi.");
      }

      setSuccessMessage(
        `${selectedUser.full_name || selectedUser.email || selectedUser.user_id} kullanıcısına ${
          payload.storeName || "yeni mağaza"
        } eklendi.`
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
    storeCurrency,
    storeNameDraft,
    storePhoneDraft,
  ]);

  const runSwitch = useCallback(
    async (store: AutomationOverviewRow) => {
      const rowWithSelection = store as AutomationOverviewRow & { selectedWebhookConfigId?: string };
      const targetWebhookConfigId = rowWithSelection.selectedWebhookConfigId ?? selectedWebhookByStore[store.storeId];

      if (!targetWebhookConfigId) {
        setError("Önce hedef webhook seçmelisin.");
        return;
      }

      setSwitchingStoreId(store.storeId);
      setError(null);
      setSuccessMessage(null);

      try {
        const response = await fetch(`/api/admin/stores/${store.storeId}/automation-switch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetWebhookConfigId }),
        });

        const payload = (await response.json()) as SwitchResponse;

        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Geçiş işlemi başarısız.");
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
      const strictOptions = webhookOptions.filter((option) =>
        eligibleIds.includes(option.id)
      );
      const fallbackOptions = strictOptions.length
        ? strictOptions
        : webhookOptions;

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
            >
              <option value="">Webhook seçin</option>
              {item.availableWebhookOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.productLabel ? `${option.name} · ${option.productLabel}` : option.name}
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
            <div className="space-y-1">
              <Button onClick={() => void runSwitch(item)} disabled={switchDisabled} className="cursor-pointer">
                {switchingStoreId === item.storeId
                  ? "Geçiriliyor..."
                  : `${selectedWebhook?.name || "Webhook"}'a Geçir`}
              </Button>
              {!item.subscriptionId ? <p className="text-xs text-amber-300">Aktif abonelik yok.</p> : null}
            </div>
          );
        },
      },
    ],
    [
      runSwitch,
      switchingStoreId,
      copiedStoreId,
      handleCopyStoreId,
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
          <div className="flex justify-end gap-2">
            <Button
              className="cursor-pointer"
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
            <Button variant="secondary" className="cursor-pointer" onClick={() => void loadOverview()} disabled={loading}>
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
            <DataTable
              columns={columns}
              data={tableRows}
              searchPlaceholder="Mağaza, kullanıcı, plan ara..."
              pageSize={8}
              statusFilterKey="storeStatus"
              dateFilterKey="automationUpdatedAt"
              statusFilterLabel="Mağaza Durumu"
              dateFilterLabel="Otomasyon Güncelleme"
              filtersInline
            />
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
                  placeholder="Örn: Elif Design Store"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Telefon No (Opsiyonel)</label>
                <Input
                  value={storePhoneDraft}
                  onChange={(event) => setStorePhoneDraft(event.target.value)}
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
    </div>
  );
}
