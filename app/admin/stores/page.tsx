"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRightLeft, ArrowUp, ArrowUpDown, Check, Copy, Loader2, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizePublicAssetUrl } from "@/lib/assets/public-url";
import { sanitizePhoneInput } from "@/lib/phone";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { toast } from "sonner";

type LastTrigger = {
  status: string | null;
  triggerType: string | null;
  responseStatus: number | null;
  responseStatusLabel?: string | null;
  responseStatusSource?: "http" | "cron-job.org" | null;
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
  directCronPresent?: boolean;
  directCronJobId?: number | null;
  lastCronSyncAt?: string | null;
  lastCronSyncStatus?: "success" | "skipped" | "error" | null;
  lastCronSyncMessage?: string | null;
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
  warning?: string | null;
};

type AutomationTableRow = AutomationOverviewRow & {
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
const normalizeForMatch = (value: string | null | undefined) =>
  (value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const resolveStoreCategoryDrafts = (
  store: Pick<AutomationOverviewRow, "category" | "productId"> | null,
  categories: PublicCategory[]
) => {
  if (!store || categories.length === 0) {
    return {
      parentCategoryId: categories[0]?.id ?? "",
      subCategoryId: categories.length ? LISTFLOW_DECIDE_VALUE : "",
    };
  }

  if (store.productId) {
    for (const category of categories) {
      const matchedSubCategory = (category.subProducts ?? []).find((subCategory) => subCategory.id === store.productId);
      if (matchedSubCategory) {
        return {
          parentCategoryId: category.id,
          subCategoryId: matchedSubCategory.id,
        };
      }
    }
  }

  const normalizedCategory = normalizeForMatch(store.category);
  if (!normalizedCategory) {
    return {
      parentCategoryId: categories[0]?.id ?? "",
      subCategoryId: categories.length ? LISTFLOW_DECIDE_VALUE : "",
    };
  }

  for (const category of categories) {
    const normalizedParent = normalizeForMatch(category.name);
    const matchedSubCategory = (category.subProducts ?? []).find((subCategory) => {
      const normalizedSubCategory = normalizeForMatch(subCategory.name);
      return (
        normalizedSubCategory === normalizedCategory ||
        normalizedCategory.includes(normalizedSubCategory) ||
        (normalizedParent && normalizedCategory.includes(normalizedParent) && normalizedCategory.includes(normalizedSubCategory))
      );
    });

    if (matchedSubCategory) {
      return {
        parentCategoryId: category.id,
        subCategoryId: matchedSubCategory.id,
      };
    }

    if (
      normalizedParent &&
      (normalizedParent === normalizedCategory || normalizedCategory.includes(normalizedParent))
    ) {
      return {
        parentCategoryId: category.id,
        subCategoryId: category.subProducts?.length ? LISTFLOW_DECIDE_VALUE : "",
      };
    }
  }

  return {
    parentCategoryId: categories[0]?.id ?? "",
    subCategoryId: categories.length ? LISTFLOW_DECIDE_VALUE : "",
  };
};

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
        .map((candidate) => normalizePublicAssetUrl(candidate) ?? "")
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
  directCronPresent?: boolean;
};

function NextTriggerCountdown({
  hasSubscription,
  targetIso,
  cadenceHours,
  directCronPresent = true,
}: NextTriggerCountdownProps) {
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

  if (!directCronPresent) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-black text-amber-300">Scheduler beklemede</p>
        <p className="text-xs text-slate-500">
          Sonraki tetik hazırlanıyor {cadenceHours ? `(plan: her ${cadenceHours} saat)` : ""}
        </p>
      </div>
    );
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

type StoreTableSortKey =
  | "storeName"
  | "userLabel"
  | "listingCount"
  | "plan"
  | "monthIndex"
  | "activeWebhookName"
  | "lastTriggerAt"
  | "nextTriggerAt";

type StoreTableSortDirection = "asc" | "desc";

const normalizeSearchText = (value: string) => {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};

const valueToSearchBlob = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => valueToSearchBlob(item)).join(" ");
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => valueToSearchBlob(item))
      .join(" ");
  }

  return "";
};

const getValueByPath = (row: Record<string, unknown>, path: string): unknown => {
  const segments = path.split(".").filter(Boolean);
  if (!segments.length) {
    return undefined;
  }

  let cursor: unknown = row;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};

const parseDateFilterValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const SORTABLE_HEADERS: Array<{ key: StoreTableSortKey; label: string }> = [
  { key: "storeName", label: "Mağaza" },
  { key: "userLabel", label: "Kullanıcı" },
  { key: "listingCount", label: "Listing" },
  { key: "plan", label: "Plan" },
  { key: "monthIndex", label: "Ay" },
  { key: "activeWebhookName", label: "Mevcut Otomasyon" },
  { key: "lastTriggerAt", label: "Son Tetik" },
  { key: "nextTriggerAt", label: "Sonraki Tetik" },
];

const getSortValue = (row: AutomationTableRow, key: StoreTableSortKey) => {
  switch (key) {
    case "storeName":
      return row.storeName || "";
    case "userLabel":
      return row.userLabel || "";
    case "listingCount":
      return row.listingCount ?? 0;
    case "plan":
      return row.plan ? PLAN_LABELS[row.plan] ?? row.plan : "";
    case "monthIndex":
      return row.monthIndex ?? 0;
    case "activeWebhookName":
      return row.activeWebhookName || "";
    case "lastTriggerAt":
      return row.lastTrigger?.createdAt ? new Date(row.lastTrigger.createdAt).getTime() : 0;
    case "nextTriggerAt":
      return row.nextTriggerAt ? new Date(row.nextTriggerAt).getTime() : 0;
    default:
      return "";
  }
};

type StoresAutomationTableProps = {
  rows: AutomationTableRow[];
  webhookMap: Map<string, WebhookOption>;
  switchingStoreId: string | null;
  copiedStoreId: string | null;
  savingStoreEdit: boolean;
  onCopyStoreId: (storeId: string) => void;
  onOpenListingViewer: (store: AutomationOverviewRow) => void;
  onOpenEditStoreModal: (store: AutomationOverviewRow) => void;
  onRunSwitch: (store: AutomationTableRow) => void;
  onSelectWebhook: (storeId: string, webhookConfigId: string) => void;
};

function StoresAutomationTable({
  rows,
  webhookMap,
  switchingStoreId,
  copiedStoreId,
  savingStoreEdit,
  onCopyStoreId,
  onOpenListingViewer,
  onOpenEditStoreModal,
  onRunSwitch,
  onSelectWebhook,
}: StoresAutomationTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortKey, setSortKey] = useState<StoreTableSortKey>("storeName");
  const [sortDirection, setSortDirection] = useState<StoreTableSortDirection>("asc");
  const [page, setPage] = useState(1);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.storeStatus).filter(Boolean))).sort((a, b) =>
      String(a).localeCompare(String(b), "tr")
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery.trim());
    const fromDate = dateFrom
      ? (() => {
          const value = new Date(dateFrom);
          value.setHours(0, 0, 0, 0);
          return value;
        })()
      : null;
    const toDate = dateTo
      ? (() => {
          const value = new Date(dateTo);
          value.setHours(23, 59, 59, 999);
          return value;
        })()
      : null;

    return rows.filter((row) => {
      if (statusFilter !== "all" && row.storeStatus.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }

      if (fromDate || toDate) {
        const rowDate = parseDateFilterValue(row.automationUpdatedAt);
        if (!rowDate) {
          return false;
        }

        if (fromDate && rowDate < fromDate) {
          return false;
        }

        if (toDate && rowDate > toDate) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchBlob = [
        "storeName",
        "storeId",
        "userLabel",
        "plan",
        "subscriptionStatus",
        "storeCurrency",
        "category",
        "activeWebhookName",
      ]
        .map((key) => valueToSearchBlob(getValueByPath(row as unknown as Record<string, unknown>, key)))
        .join(" ");

      return normalizeSearchText(searchBlob).includes(normalizedQuery);
    });
  }, [dateFrom, dateTo, rows, searchQuery, statusFilter]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => {
      const leftValue = getSortValue(left, sortKey);
      const rightValue = getSortValue(right, sortKey);

      let result = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "tr", { sensitivity: "base" });
      }

      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredRows, sortDirection, sortKey]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [page, sortedRows]);

  const toggleSort = (key: StoreTableSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  };

  const renderSortIcon = (key: StoreTableSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />;
    }

    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-indigo-300" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-indigo-300" />
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_200px_170px_170px_auto]">
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Mağaza, kullanıcı, plan ara..."
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Mağaza durumu: Tümü</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <DatePicker
            value={dateFrom}
            onChange={(value) => {
              setDateFrom(value);
              setPage(1);
            }}
            placeholder="Otomasyon başlangıç"
          />
          <DatePicker
            value={dateTo}
            onChange={(value) => {
              setDateTo(value);
              setPage(1);
            }}
            placeholder="Otomasyon bitiş"
          />
          <Button variant="outline" onClick={clearFilters} className="cursor-pointer">
            Filtreleri Temizle
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          {sortedRows.length} kayıt, sayfa {page}/{totalPages}
        </p>
      </div>

      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow>
            {SORTABLE_HEADERS.map((header) => (
              <TableHead key={header.key}>
                <button
                  type="button"
                  onClick={() => toggleSort(header.key)}
                  className="inline-flex items-center gap-2 text-left text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white cursor-pointer"
                >
                  <span>{header.label}</span>
                  {renderSortIcon(header.key)}
                </button>
              </TableHead>
            ))}
            <TableHead>Hedef Geçiş</TableHead>
            <TableHead>Aksiyon</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-10 text-center text-slate-500">
                Kayıt bulunamadı.
              </TableCell>
            </TableRow>
          ) : null}
          {paginatedRows.map((item) => {
            const trigger = item.lastTrigger;
            const triggerWebhookName = trigger?.webhookConfigId
              ? webhookMap.get(trigger.webhookConfigId)?.name ?? trigger.webhookConfigId
              : null;
            const selectedWebhook =
              item.availableWebhookOptions.find((option) => option.id === item.selectedWebhookConfigId) ?? null;
            const switchDisabled =
              !item.canSwitch || !item.selectedWebhookConfigId || switchingStoreId === item.storeId;

            return (
              <TableRow key={item.storeId}>
                <TableCell>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-white/5 px-2 py-1 text-[11px] font-black text-indigo-200">{item.storeId}</code>
                      <button
                        type="button"
                        onClick={() => onCopyStoreId(item.storeId)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-white/5 text-slate-300 hover:text-white cursor-pointer"
                        title="Store ID kopyala"
                      >
                        {copiedStoreId === item.storeId ? (
                          <Check className="h-3.5 w-3.5 text-emerald-300" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="font-black text-white">{item.storeName}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant={getStatusVariant(item.storeStatus)}>{item.storeStatus}</Badge>
                      <Badge variant="secondary">{item.storeCurrency === "TRY" ? "TRY" : "USD"}</Badge>
                      <span className="text-xs text-slate-500">{item.category || "-"}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{item.userLabel}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => void onOpenListingViewer(item)}
                    className={`text-sm font-black cursor-pointer underline-offset-2 hover:underline ${
                      (item.listingCount ?? 0) > 0 ? "text-emerald-400" : "text-slate-500"
                    }`}
                    title={`${item.storeName} listinglerini göster`}
                  >
                    {item.listingCount ?? 0}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Badge variant={getStatusVariant(item.subscriptionStatus)}>{item.subscriptionStatus || "-"}</Badge>
                    <p className="text-xs text-slate-400">{item.plan ? PLAN_LABELS[item.plan] ?? item.plan : "-"}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-sm font-black text-white">{item.monthIndex}. Ay</p>
                    <p className="text-xs text-slate-500">Dönem sonu: {formatDate(item.currentPeriodEnd)}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-200">{item.activeWebhookName || "-"}</p>
                    <p className="text-xs text-slate-500">Güncelleme: {formatDate(item.automationUpdatedAt)}</p>
                  </div>
                </TableCell>
                <TableCell>
                  {!trigger ? (
                    <span className="text-xs text-slate-500">Henüz job yok</span>
                  ) : (
                    <div className="space-y-1">
                      <Badge variant={getStatusVariant(trigger.status)}>
                        {trigger.triggerType || "scheduled"} / {trigger.status || "-"}
                      </Badge>
                      <p className="text-xs text-slate-500">
                        {trigger.responseStatusSource === "cron-job.org"
                          ? `${trigger.responseStatusLabel ?? "cron-job.org"} - ${formatDate(trigger.createdAt)}`
                          : `${trigger.responseStatusLabel ?? `HTTP ${trigger.responseStatus ?? "-"}`} - ${formatDate(trigger.createdAt)}`}
                      </p>
                      {triggerWebhookName ? <p className="text-xs text-slate-400">{triggerWebhookName}</p> : null}
                      {item.lastCronSyncStatus ? (
                        <p className="text-xs text-slate-500">
                          Cron sync: {item.lastCronSyncStatus} - {formatDate(item.lastCronSyncAt ?? null)}
                        </p>
                      ) : null}
                      {trigger.errorMessage ? (
                        <p className="text-xs text-red-300">{formatErrorMessage(trigger.errorMessage)}</p>
                      ) : null}
                      {item.lastCronSyncMessage ? (
                        <p className="text-xs text-slate-500">{item.lastCronSyncMessage}</p>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <NextTriggerCountdown
                      hasSubscription={Boolean(item.subscriptionId)}
                      targetIso={item.nextTriggerAt}
                      cadenceHours={item.cadenceHours}
                      directCronPresent={item.directCronPresent}
                    />
                    <p className="text-xs text-slate-500">
                      {item.directCronPresent
                        ? `cron scheduler aktif${item.directCronJobId ? ` (#${item.directCronJobId})` : ""}`
                        : "cron scheduler beklemede"}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="min-w-[260px]">
                  <Select
                    value={item.selectedWebhookConfigId}
                    onChange={(event) => onSelectWebhook(item.storeId, event.target.value)}
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
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => void onRunSwitch(item)}
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
                        onClick={() => onOpenEditStoreModal(item)}
                        disabled={savingStoreEdit}
                        title="Mağazayı düzenle"
                        aria-label="Mağazayı düzenle"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                    {selectedWebhook ? (
                      <p className="max-w-[220px] truncate text-xs text-slate-400" title={selectedWebhook.name}>
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
          {sortedRows.length === 0
            ? "0 kayıt"
            : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, sortedRows.length)} / ${sortedRows.length} kayıt`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Önceki
          </Button>
          <span className="min-w-[72px] text-center text-xs text-slate-400">
            Sayfa {page}/{totalPages}
          </span>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
          >
            Sonraki
          </Button>
        </div>
      </div>
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
  const [editSelectedParentCategoryId, setEditSelectedParentCategoryId] = useState("");
  const [editSelectedSubCategoryId, setEditSelectedSubCategoryId] = useState("");
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
  const editSelectedParentCategory = useMemo(
    () => categories.find((category) => category.id === editSelectedParentCategoryId) ?? categories[0] ?? null,
    [categories, editSelectedParentCategoryId]
  );
  const editAvailableSubCategories = useMemo(() => {
    if (!editSelectedParentCategory) {
      return [] as PublicSubCategory[];
    }

    return (editSelectedParentCategory.subProducts ?? [])
      .map((subProduct) => ({
        id: subProduct.id,
        name: subProduct.name,
      }))
      .filter((item) => Boolean(item.id) && Boolean(item.name));
  }, [editSelectedParentCategory]);
  const editResolvedSubCategory = useMemo(() => {
    if (!editAvailableSubCategories.length) {
      return null;
    }

    if (editSelectedSubCategoryId === LISTFLOW_DECIDE_VALUE || !editSelectedSubCategoryId) {
      return editAvailableSubCategories[0];
    }

    return editAvailableSubCategories.find((subcategory) => subcategory.id === editSelectedSubCategoryId) ?? editAvailableSubCategories[0];
  }, [editAvailableSubCategories, editSelectedSubCategoryId]);
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

  const loadOverview = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
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
          const allWebhookIds = nextWebhookOptions.map((option) => option.id);
          const selectedCurrent = next[row.storeId];
          const hasSelectedStillValid = allWebhookIds.includes(selectedCurrent);
          const defaultTarget =
            row.activeWebhookConfigId && allWebhookIds.includes(row.activeWebhookConfigId)
              ? row.activeWebhookConfigId
              : "";

          next[row.storeId] = hasSelectedStillValid ? selectedCurrent : defaultTarget;
        }

        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation overview yüklenemedi.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
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
    if (!editStoreOpen || categories.length > 0 || categoriesLoading) {
      return;
    }

    void loadCategories();
  }, [editStoreOpen, categories.length, categoriesLoading, loadCategories]);

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

  useEffect(() => {
    if (!editStoreOpen || !editingStore || !categories.length) {
      return;
    }

    const nextDrafts = resolveStoreCategoryDrafts(editingStore, categories);
    setEditSelectedParentCategoryId(nextDrafts.parentCategoryId);
    setEditSelectedSubCategoryId(nextDrafts.subCategoryId);
  }, [categories, editStoreOpen, editingStore]);

  useEffect(() => {
    if (!editAvailableSubCategories.length) {
      if (editSelectedSubCategoryId !== "") {
        setEditSelectedSubCategoryId("");
      }
      return;
    }

    if (
      editSelectedSubCategoryId &&
      editSelectedSubCategoryId !== LISTFLOW_DECIDE_VALUE &&
      editAvailableSubCategories.some((subcategory) => subcategory.id === editSelectedSubCategoryId)
    ) {
      return;
    }

    setEditSelectedSubCategoryId(LISTFLOW_DECIDE_VALUE);
  }, [editAvailableSubCategories, editSelectedSubCategoryId]);

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
      await loadOverview({ silent: true });
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
    const nextDrafts = resolveStoreCategoryDrafts(store, categories);
    setEditingStore(store);
    setEditStoreNameDraft(store.storeName || "");
    setEditStoreCurrencyDraft(store.storeCurrency === "TRY" ? "TRY" : "USD");
    setEditStorePlanDraft(resolvedPlan);
    setEditSelectedParentCategoryId(nextDrafts.parentCategoryId);
    setEditSelectedSubCategoryId(nextDrafts.subCategoryId);
    setEditStoreOpen(true);
    setError(null);
    setSuccessMessage(null);
    if (!categories.length) {
      void loadCategories();
    }
  }, [categories, loadCategories]);

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
    const selectedParentCategory =
      categories.find((category) => category.id === editSelectedParentCategoryId) ?? categories[0] ?? null;

    if (!selectedParentCategory) {
      setError("Kategori listesi yüklenemedi. Lütfen tekrar deneyin.");
      return;
    }

    const selectedSubCategories = (selectedParentCategory.subProducts ?? []).filter(
      (subCategory) => Boolean(subCategory.id) && Boolean(subCategory.name)
    );
    const selectedSubCategory =
      !selectedSubCategories.length
        ? null
        : editSelectedSubCategoryId === LISTFLOW_DECIDE_VALUE || !editSelectedSubCategoryId
          ? selectedSubCategories[0] ?? null
          : selectedSubCategories.find((subCategory) => subCategory.id === editSelectedSubCategoryId) ??
            selectedSubCategories[0] ??
            null;

    const nextCategoryName = selectedSubCategory?.name || selectedParentCategory.name;
    const nextTopCategoryId =
      (selectedParentCategory.dbId && selectedParentCategory.dbId.trim()) ||
      (selectedParentCategory.id && selectedParentCategory.id.trim()) ||
      null;
    const nextSubCategoryId = selectedSubCategory?.id?.trim() || null;
    const changedStoreName = normalizedStoreName !== currentStoreName;
    const changedCurrency = editStoreCurrencyDraft !== currentCurrency;
    const changedPlan = hasSubscription && editStorePlanDraft !== currentPlan;
    const changedCategory =
      normalizeForMatch(nextCategoryName) !== normalizeForMatch(editingStore.category) ||
      (editingStore.productId ?? null) !== nextSubCategoryId;
    const noChanges = !changedStoreName && !changedCurrency && !changedPlan && !changedCategory;

    if (noChanges) {
      setSuccessMessage("Kaydedilecek bir değişiklik bulunamadı.");
      setEditStoreOpen(false);
      setEditingStore(null);
      setEditStoreNameDraft("");
      setEditStoreCurrencyDraft("USD");
      setEditStorePlanDraft("standard");
      setEditSelectedParentCategoryId("");
      setEditSelectedSubCategoryId("");
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
      if (changedCategory) {
        patchPayload.category = nextCategoryName;
        patchPayload.topCategoryId = nextTopCategoryId;
        patchPayload.subCategoryId = nextSubCategoryId;
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
      if (changedCategory) changeLabels.push(`kategori: ${selectedParentCategory.name}${selectedSubCategory ? ` / ${selectedSubCategory.name}` : ""}`);
      if (changedPlan) changeLabels.push(`plan: ${PLAN_LABELS[editStorePlanDraft]}`);
      setSuccessMessage(`${editingStore.storeName} mağazası güncellendi (${changeLabels.join(", ")}).`);
      setEditStoreOpen(false);
      setEditingStore(null);
      setEditStoreNameDraft("");
      setEditStoreCurrencyDraft("USD");
      setEditStorePlanDraft("standard");
      setEditSelectedParentCategoryId("");
      setEditSelectedSubCategoryId("");
      await loadOverview({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mağaza güncellenemedi.");
    } finally {
      setSavingStoreEdit(false);
    }
  }, [
    categories,
    editSelectedParentCategoryId,
    editSelectedSubCategoryId,
    editStoreCurrencyDraft,
    editStoreNameDraft,
    editStorePlanDraft,
    editingStore,
    loadOverview,
  ]);

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
    async (store: AutomationTableRow) => {
      const rowWithSelection = store as AutomationTableRow;
      const targetWebhookConfigId = rowWithSelection.selectedWebhookConfigId ?? selectedWebhookByStore[store.storeId];

      if (!targetWebhookConfigId) {
        setError("Önce hedef webhook seçmelisin.");
        return;
      }

      const isTargetVisible = webhookMap.has(targetWebhookConfigId);
      if (!isTargetVisible) {
        setError("Seçilen webhook listede bulunamadı. Lütfen tekrar seç.");
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
        const warningText =
          typeof payload.warning === "string" && payload.warning.trim().length > 0
            ? ` Uyarı: ${payload.warning}`
            : "";
        setSuccessMessage(`${store.storeName} için ${webhookName} otomasyonu tetiklendi.${warningText}`);
        await loadOverview({ silent: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Geçiş işlemi başarısız.");
      } finally {
        setSwitchingStoreId(null);
      }
    },
    [loadOverview, selectedWebhookByStore, webhookMap]
  );

  const tableRows = useMemo<AutomationTableRow[]>(() => {
    return rows.map((row) => {
      const selectedCurrent = selectedWebhookByStore[row.storeId] ?? "";
      const selectedWebhookConfigId = webhookOptions.some((option) => option.id === selectedCurrent)
        ? selectedCurrent
        : row.activeWebhookConfigId && webhookOptions.some((option) => option.id === row.activeWebhookConfigId)
          ? row.activeWebhookConfigId
          : webhookOptions[0]?.id ?? "";

      return {
        ...row,
        selectedWebhookConfigId,
        availableWebhookOptions: webhookOptions,
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
              <StoresAutomationTable
                rows={tableRows}
                webhookMap={webhookMap}
                switchingStoreId={switchingStoreId}
                copiedStoreId={copiedStoreId}
                savingStoreEdit={savingStoreEdit}
                onCopyStoreId={(storeId) => void handleCopyStoreId(storeId)}
                onOpenListingViewer={(store) => void openListingViewer(store)}
                onOpenEditStoreModal={openEditStoreModal}
                onRunSwitch={(store) => void runSwitch(store)}
                onSelectWebhook={(storeId, webhookConfigId) =>
                  setSelectedWebhookByStore((prev) => ({
                    ...prev,
                    [storeId]: webhookConfigId,
                  }))
                }
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
            setEditSelectedParentCategoryId("");
            setEditSelectedSubCategoryId("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mağaza Düzenle</DialogTitle>
            <DialogDescription>
              {editingStore
                ? `${editingStore.storeId} için mağaza adı, kategori, para birimi ve abonelik planını güncelle`
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

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Üst Kategori</label>
              <Select
                value={editSelectedParentCategoryId}
                onChange={(event) => setEditSelectedParentCategoryId(event.target.value)}
                disabled={!editingStore || savingStoreEdit || categoriesLoading || categories.length === 0}
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
                value={editAvailableSubCategories.length ? editSelectedSubCategoryId : ""}
                onChange={(event) => setEditSelectedSubCategoryId(event.target.value)}
                disabled={!editingStore || savingStoreEdit || categoriesLoading || !editAvailableSubCategories.length}
              >
                {editAvailableSubCategories.length ? <option value={LISTFLOW_DECIDE_VALUE}>Listflow karar versin</option> : null}
                {!editAvailableSubCategories.length ? <option value="">Alt kategori yok</option> : null}
                {editAvailableSubCategories.map((subcategory) => (
                  <option key={subcategory.id} value={subcategory.id}>
                    {subcategory.name}
                  </option>
                ))}
              </Select>
              {editSelectedSubCategoryId === LISTFLOW_DECIDE_VALUE && editAvailableSubCategories.length ? (
                <p className="text-xs text-slate-500">
                  Listflow karar versin seçiliyken ilk alt kategori kullanılır: {editAvailableSubCategories[0]?.name}
                </p>
              ) : null}
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
                setEditSelectedParentCategoryId("");
                setEditSelectedSubCategoryId("");
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
