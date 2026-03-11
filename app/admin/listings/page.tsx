"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type ListingAdminRow = Record<string, unknown> & {
  id?: string;
  key?: string | null;
  title?: string | null;
  status?: string | null;
  listing_status?: string | null;
  derived_status?: string;
  derived_client_id?: string;
  derived_store_name?: string | null;
  derived_store_category?: string | null;
  derived_listing_url?: string;
  is_uploaded?: boolean;
  manual_review?: boolean;
  manual_review_reason?: string | null;
  category_mismatch?: boolean;
  etsy_listing_id?: string | null;
  last_error?: string | null;
  error?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ListingsResponse = {
  rows?: ListingAdminRow[];
  total?: number;
  has_more?: boolean;
  error?: string;
};

type AutomationOverviewResponse = {
  rows?: Array<{
    storeId?: string;
    storeName?: string;
  }>;
  error?: string;
};

type ExtensionLog = {
  id: string;
  user_id: string | null;
  store_id: string | null;
  store_name: string | null;
  level: string;
  event: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ExtensionLogsResponse = {
  logs?: ExtensionLog[];
  has_more?: boolean;
  error?: string;
};

const STATUS_OPTIONS = [
  { value: "all", label: "Tümü" },
  { value: "pending", label: "pending" },
  { value: "processing", label: "processing" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
  { value: "manual_review", label: "manual_review" },
  { value: "uploaded", label: "Yüklendi (kanıtlı)" },
  { value: "not_uploaded", label: "Yüklenmedi" },
] as const;

const LOG_LEVELS = ["all", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];
const LOG_PAGE_SIZE = 50;

const fmtDate = (value: unknown) => {
  if (!value || typeof value !== "string") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR");
};

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getPathValue = (source: Record<string, unknown>, path: string) => {
  const segments = path.split(".").filter(Boolean);
  if (!segments.length) {
    return undefined;
  }

  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

const pickFirstText = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = getPathValue(source, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const pickFirstNumber = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = getPathValue(source, key);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }
  return null;
};

const formatMaybePrice = (value: number) =>
  value.toLocaleString("tr-TR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });

const resolveTopCategory = (row: ListingAdminRow) =>
  pickFirstText(row, [
    "top_category",
    "topCategory",
    "main_category",
    "mainCategory",
    "category",
    "category_name",
    "parent_category",
    "metadata.top_category",
    "metadata.category",
    "payload.category",
    "product.category",
  ]);

const resolveSubCategory = (row: ListingAdminRow) =>
  pickFirstText(row, [
    "sub_category",
    "subCategory",
    "subcategory",
    "sub_category_name",
    "sub_product_name",
    "product_name",
    "metadata.sub_category",
    "metadata.subcategory",
    "payload.sub_category",
    "product.sub_category",
  ]);

const resolvePrice = (row: ListingAdminRow) => {
  const cents = pickFirstNumber(row, ["price_cents", "amount_cents"]);
  if (cents !== null) {
    return formatMaybePrice(cents / 100);
  }

  const numeric = pickFirstNumber(row, [
    "price",
    "listing_price",
    "price_value",
    "price_amount",
    "amount",
    "sale_price",
    "metadata.price",
    "payload.price",
    "product.price",
  ]);
  if (numeric !== null) {
    return formatMaybePrice(numeric);
  }

  return (
    pickFirstText(row, [
      "price",
      "listing_price",
      "price_value",
      "price_amount",
      "metadata.price",
      "payload.price",
      "product.price",
    ]) || "-"
  );
};

const StatusBadge = ({ row }: { row: ListingAdminRow }) => {
  const status = toText(row.derived_status || row.status || row.listing_status || "-").toLowerCase();

  if (status === "completed") {
    return <Badge variant="success">completed</Badge>;
  }
  if (status === "processing") {
    return <Badge variant="warning">processing</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>;
  }
  if (status === "manual_review") {
    return (
      <Badge variant="secondary" className="border-orange-500/30 bg-orange-500/15 text-orange-300">
        manual_review
      </Badge>
    );
  }
  if (status === "pending") {
    return <Badge variant="secondary">pending</Badge>;
  }
  return <Badge variant="outline">{status || "-"}</Badge>;
};

const LogLevelBadge = ({ level }: { level: string }) => {
  if (level === "error") return <Badge variant="destructive">{level}</Badge>;
  if (level === "warn") {
    return (
      <Badge variant="secondary" className="border-amber-500/30 bg-amber-500/15 text-amber-400">
        {level}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="border-indigo-500/30 bg-indigo-500/15 text-indigo-300">
      {level}
    </Badge>
  );
};

export default function AdminListingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTab = searchParams.get("tab") === "logs" ? "logs" : "listings";
  const [activeTab, setActiveTab] = useState<"listings" | "logs">(searchTab);

  const [rows, setRows] = useState<ListingAdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [requeueLoadingId, setRequeueLoadingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState("");
  const [search, setSearch] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState<Date | undefined>(undefined);
  const [updatedTo, setUpdatedTo] = useState<Date | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [storeNameByClientId, setStoreNameByClientId] = useState<Record<string, string>>({});

  const [logs, setLogs] = useState<ExtensionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [storeFilter, setStoreFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsOffset, setLogsOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<ExtensionLog | null>(null);
  const [logActionLoading, setLogActionLoading] = useState<"delete" | "requeue" | null>(null);

  useEffect(() => {
    setActiveTab(searchTab);
  }, [searchTab]);

  const updateUrlTab = useCallback(
    (tab: "listings" | "logs") => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === "logs") {
        next.set("tab", "logs");
      } else {
        next.delete("tab");
      }
      const query = next.toString();
      router.replace(query ? `/admin/listings?${query}` : "/admin/listings", { scroll: false });
    },
    [router, searchParams]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const tab = value === "logs" ? "logs" : "listings";
      setActiveTab(tab);
      updateUrlTab(tab);
    },
    [updateUrlTab]
  );

  const fetchStoreNames = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stores/automation-overview", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as AutomationOverviewResponse;

      if (!response.ok) {
        throw new Error(body.error || "Mağaza eşlemesi yüklenemedi.");
      }

      const map: Record<string, string> = {};
      for (const row of body.rows ?? []) {
        const id = toText(row.storeId);
        if (!id) continue;
        map[id] = toText(row.storeName) || id;
      }
      setStoreNameByClientId(map);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mağaza eşlemesi yüklenemedi.";
      toast.error(message);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: "500",
      });

      if (clientFilter.trim()) {
        params.set("client_id", clientFilter.trim());
      }

      if (search.trim()) {
        params.set("q", search.trim());
      }

      const response = await fetch(`/api/admin/listings?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ListingsResponse;

      if (!response.ok) {
        throw new Error(body.error || "Listing verileri yüklenemedi.");
      }

      setRows(body.rows ?? []);
      setTotal(Number(body.total ?? (body.rows ?? []).length));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Listing verileri yüklenemedi.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [clientFilter, search, statusFilter]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    void fetchStoreNames();
  }, [fetchStoreNames]);

  const fetchLogs = useCallback(
    async (reset: boolean, levelArg = levelFilter, storeArg = storeFilter, eventArg = eventFilter) => {
      setLogsLoading(true);
      const offset = reset ? 0 : logsOffset;

      try {
        const params = new URLSearchParams({ offset: String(offset) });
        if (levelArg && levelArg !== "all") params.set("level", levelArg);
        if (storeArg.trim()) params.set("store_name", storeArg.trim());
        if (eventArg.trim()) params.set("event", eventArg.trim());

        const response = await fetch(`/api/admin/extension-logs?${params.toString()}`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as ExtensionLogsResponse;
        if (!response.ok) {
          throw new Error(body.error || "Eklenti logları yüklenemedi.");
        }

        const nextRows = body.logs ?? [];
        if (reset) {
          setLogs(nextRows);
          setLogsOffset(nextRows.length);
        } else {
          setLogs((prev) => [...prev, ...nextRows]);
          setLogsOffset((prev) => prev + nextRows.length);
        }
        setLogsHasMore(Boolean(body.has_more ?? nextRows.length === LOG_PAGE_SIZE));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Eklenti logları yüklenemedi.";
        toast.error(message);
      } finally {
        setLogsLoading(false);
      }
    },
    [eventFilter, levelFilter, logsOffset, storeFilter]
  );

  useEffect(() => {
    void fetchLogs(true, "all", "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterLogs = useCallback(async () => {
    setLogsOffset(0);
    await fetchLogs(true, levelFilter, storeFilter, eventFilter);
  }, [eventFilter, fetchLogs, levelFilter, storeFilter]);

  const handleResetLogs = useCallback(() => {
    setLevelFilter("all");
    setStoreFilter("");
    setEventFilter("");
    setLogsOffset(0);
    void fetchLogs(true, "all", "", "");
  }, [fetchLogs]);

  const requeueRow = useCallback(
    async (row: ListingAdminRow) => {
      const listingId = toText(row.id);
      const listingKey = toText(row.key);
      const actionId = listingId || `key:${listingKey}`;

      if (!listingId && !listingKey) {
        toast.error("Kayıt id/key bilgisi eksik olduğu için yeniden kuyruğa alınamadı.");
        return;
      }

      setRequeueLoadingId(actionId);
      try {
        const response = await fetch("/api/admin/listings/requeue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listing_id: listingId || undefined,
            listing_key: listingId ? undefined : listingKey,
          }),
        });

        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };

        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Listing yeniden kuyruğa alınamadı.");
        }

        toast.success(body.message || "Listing yeniden kuyruğa alındı.");
        await fetchRows();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Listing yeniden kuyruğa alınamadı.";
        toast.error(message);
      } finally {
        setRequeueLoadingId(null);
      }
    },
    [fetchRows]
  );

  const handleReconcileMismatch = useCallback(async () => {
    setReconcileLoading(true);
    try {
      const response = await fetch("/api/admin/listings/reconcile-mismatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        scanned?: number;
        updated?: number;
        mismatch_marked?: number;
        stale_processing_marked?: number;
      };

      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Listing bakım işlemi başarısız.");
      }

      toast.success(
        `Bakım tamamlandı. Tarandı: ${body.scanned ?? 0}, güncellendi: ${body.updated ?? 0}, mismatch: ${body.mismatch_marked ?? 0}, stale processing: ${body.stale_processing_marked ?? 0}`
      );
      await fetchRows();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Listing bakım işlemi başarısız.";
      toast.error(message);
    } finally {
      setReconcileLoading(false);
    }
  }, [fetchRows]);

  const deleteLogAndOptionallyRequeue = useCallback(
    async (opts: { requeue: boolean }) => {
      if (!selectedLog) return;
      setLogActionLoading(opts.requeue ? "requeue" : "delete");
      try {
        const response = await fetch(
          `/api/admin/extension-logs/${selectedLog.id}?requeue=${opts.requeue ? "true" : "false"}`,
          { method: "DELETE" }
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          listing_requeued?: boolean;
          guest_sheet_reset?: boolean;
        };

        if (!response.ok) {
          throw new Error(body.error || "İşlem başarısız.");
        }

        if (opts.requeue) {
          const requeueInfo = [body.listing_requeued ? "listing requeue ✓" : null, body.guest_sheet_reset ? "sheet reset ✓" : null]
            .filter(Boolean)
            .join(", ");
          toast.success(
            requeueInfo
              ? `Log silindi ve tekrar kuyruğa alındı (${requeueInfo}).`
              : "Log silindi ve tekrar kuyruğa alma isteği işlendi."
          );
        } else {
          toast.success("Log silindi.");
        }

        setSelectedLog(null);
        setLogsOffset(0);
        await fetchLogs(true, levelFilter, storeFilter, eventFilter);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "İşlem başarısız.");
      } finally {
        setLogActionLoading(null);
      }
    },
    [eventFilter, fetchLogs, levelFilter, selectedLog, storeFilter]
  );

  const columns = useMemo<ColumnDef<ListingAdminRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        cell: ({ row }) => {
          const id = toText(row.original.id) || toText(row.original.key) || "-";
          return <span className="text-xs font-mono bg-white/5 px-1.5 py-0.5 rounded">{id}</span>;
        },
      },
      {
        accessorKey: "title",
        header: "Başlık",
        cell: ({ row }) => (
          <span className="text-xs text-slate-200 line-clamp-2 max-w-[260px]">{toText(row.original.title) || "-"}</span>
        ),
      },
      {
        accessorKey: "derived_client_id",
        header: "Mağaza / Client ID",
        cell: ({ row }) => {
          const clientId = toText(row.original.derived_client_id);
          const storeName = toText(row.original.derived_store_name) || (clientId ? storeNameByClientId[clientId] : "");
          return <span className="text-xs">{storeName || clientId || "-"}</span>;
        },
      },
      {
        accessorKey: "derived_status",
        header: "Durum",
        cell: ({ row }) => <StatusBadge row={row.original} />,
      },
      {
        id: "product_info",
        header: "Ürün Bilgisi",
        cell: ({ row }) => {
          const topCategory = resolveTopCategory(row.original);
          const subCategory = resolveSubCategory(row.original);
          const price = resolvePrice(row.original);
          return (
            <div className="max-w-[260px] space-y-1 text-xs">
              <p className="text-slate-300">
                <span className="text-slate-500">Üst:</span> {topCategory || "-"}
              </p>
              <p className="text-slate-300">
                <span className="text-slate-500">Alt:</span> {subCategory || "-"}
              </p>
              <p className="text-slate-300">
                <span className="text-slate-500">Fiyat:</span> {price}
              </p>
              {row.original.category_mismatch ? (
                <p className="text-amber-300">
                  <span className="text-amber-500/80">İnceleme:</span> mağaza kategorisiyle uyuşmuyor
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "etsy_listing_id",
        header: "Etsy Listing ID",
        cell: ({ row }) => <span className="text-xs">{toText(row.original.etsy_listing_id) || "-"}</span>,
      },
      {
        accessorKey: "derived_listing_url",
        header: "Etsy URL",
        cell: ({ row }) => {
          const url = toText(row.original.derived_listing_url);
          if (!url) return <span className="text-xs">-</span>;
          return (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 hover:underline">
              Aç
            </a>
          );
        },
      },
      {
        accessorKey: "updated_at",
        header: "Güncelleme",
        cell: ({ row }) => <span className="text-xs text-slate-300 whitespace-nowrap">{fmtDate(row.original.updated_at)}</span>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const listingId = toText(row.original.id);
          const listingKey = toText(row.original.key);
          const actionId = listingId || `key:${listingKey}`;

          return (
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer"
              onClick={() => void requeueRow(row.original)}
              disabled={Boolean(requeueLoadingId && requeueLoadingId === actionId)}
            >
              {requeueLoadingId === actionId ? "İşleniyor…" : "Tekrar Kuyruğa Al"}
            </Button>
          );
        },
      },
    ],
    [requeueLoadingId, requeueRow, storeNameByClientId]
  );

  const logColumns = useMemo<ColumnDef<ExtensionLog>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Tarih",
        cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(row.original.created_at)}</span>,
      },
      {
        accessorKey: "level",
        header: "Seviye",
        cell: ({ row }) => <LogLevelBadge level={row.original.level} />,
      },
      {
        accessorKey: "store_name",
        header: "Mağaza",
        cell: ({ row }) => <span className="text-xs">{row.original.store_name || row.original.store_id || "-"}</span>,
      },
      {
        accessorKey: "event",
        header: "Olay",
        cell: ({ row }) => <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs">{row.original.event}</code>,
      },
      {
        accessorKey: "message",
        header: "Mesaj",
        cell: ({ row }) => <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">{row.original.message || "-"}</span>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs cursor-pointer" onClick={() => setSelectedLog(row.original)}>
            Detay
          </Button>
        ),
      },
    ],
    []
  );

  const dateFilteredRows = useMemo(() => {
    if (!updatedFrom && !updatedTo) {
      return rows;
    }

    const fromDate = updatedFrom
      ? (() => {
          const value = new Date(updatedFrom);
          value.setHours(0, 0, 0, 0);
          return value;
        })()
      : null;

    const toDate = updatedTo
      ? (() => {
          const value = new Date(updatedTo);
          value.setHours(23, 59, 59, 999);
          return value;
        })()
      : null;

    return rows.filter((row) => {
      const raw = row.updated_at;
      if (!raw || typeof raw !== "string") {
        return false;
      }
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        return false;
      }
      if (fromDate && date < fromDate) {
        return false;
      }
      if (toDate && date > toDate) {
        return false;
      }
      return true;
    });
  }, [rows, updatedFrom, updatedTo]);

  const clearListingFilters = useCallback(() => {
    setStatusFilter("all");
    setClientFilter("");
    setSearch("");
    setUpdatedFrom(undefined);
    setUpdatedTo(undefined);
  }, []);

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro">
        <CardHeader>
          <CardTitle>Listing ve Eklenti Log Takibi</CardTitle>
          <CardDescription>
            Listing kayıtlarını ve eklenti loglarını tek ekranda takip edebilirsiniz.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="listings">Listing Takibi</TabsTrigger>
              <TabsTrigger value="logs">Eklenti Logları</TabsTrigger>
            </TabsList>

            <TabsContent value="listings" className="space-y-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-9 min-w-[12rem] w-52 shrink-0"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>

                <Input
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  placeholder="Mağaza adı veya Client ID filtrele"
                  className="h-9 min-w-[12rem] w-56 shrink-0"
                />

                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Mağaza adı, ID, başlık, Etsy ID ara"
                  className="h-9 min-w-[15rem] w-72 shrink-0"
                />

                <span className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">Güncelleme</span>

                <DatePicker
                  value={updatedFrom}
                  onChange={setUpdatedFrom}
                  placeholder="Başlangıç"
                  className="h-9 min-w-[10.5rem] w-44 shrink-0"
                />
                <DatePicker
                  value={updatedTo}
                  onChange={setUpdatedTo}
                  placeholder="Bitiş"
                  className="h-9 min-w-[10.5rem] w-44 shrink-0"
                  minDate={updatedFrom}
                />

                <Button
                  variant="secondary"
                  onClick={clearListingFilters}
                  className="h-9 cursor-pointer shrink-0"
                >
                  Temizle
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => void handleReconcileMismatch()}
                  disabled={reconcileLoading}
                  className="h-9 cursor-pointer shrink-0"
                >
                  {reconcileLoading ? "Bakım çalışıyor…" : "Mismatch Bakımı"}
                </Button>

                <Button onClick={() => void fetchRows()} disabled={loading} className="h-9 cursor-pointer shrink-0">
                  {loading ? "Yükleniyor…" : "Yenile"}
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-2 sm:p-3">
                <DataTable columns={columns} data={dateFilteredRows} enableSearch={false} emptyMessage="Kayıt bulunamadı." />
              </div>

              <p className="text-xs text-slate-500">
                Görünen kayıt: {dateFilteredRows.length} / Sunucudan gelen toplam: {total}
              </p>
            </TabsContent>

            <TabsContent value="logs" className="space-y-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <Select
                  value={levelFilter}
                  onChange={(event) => setLevelFilter(event.target.value as LogLevel)}
                  className="h-9 min-w-[10rem] w-44 shrink-0"
                >
                  {LOG_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level === "all" ? "Tümü" : level}
                    </option>
                  ))}
                </Select>

                <Input
                  placeholder="Mağaza adı filtrele..."
                  value={storeFilter}
                  onChange={(event) => setStoreFilter(event.target.value)}
                  className="h-9 min-w-[12rem] w-56 shrink-0"
                />

                <Input
                  placeholder="Olay filtrele..."
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                  className="h-9 min-w-[12rem] w-56 shrink-0"
                />

                <Button onClick={() => void handleFilterLogs()} disabled={logsLoading} className="h-9 cursor-pointer shrink-0">
                  {logsLoading ? "Yükleniyor…" : "Filtrele"}
                </Button>

                <Button
                  variant="secondary"
                  className="h-9 cursor-pointer shrink-0"
                  onClick={handleResetLogs}
                  disabled={logsLoading}
                >
                  Temizle
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-2 sm:p-3">
                <DataTable columns={logColumns} data={logs} enableSearch={false} emptyMessage="Log bulunamadı." />
              </div>

              {logsHasMore ? (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => void fetchLogs(false)}
                    disabled={logsLoading}
                  >
                    {logsLoading ? "Yükleniyor…" : "Daha Fazla Yükle"}
                  </Button>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => (!open ? setSelectedLog(null) : undefined)}>
        <DialogContent className="max-w-3xl">
          {selectedLog ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <LogLevelBadge level={selectedLog.level} />
                  <code className="text-sm">{selectedLog.event}</code>
                </DialogTitle>
                <DialogDescription>
                  {fmtDate(selectedLog.created_at)}
                  {selectedLog.store_name ? ` · ${selectedLog.store_name}` : ""}
                  {selectedLog.store_id ? ` (${selectedLog.store_id})` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {selectedLog.message ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Mesaj</p>
                    <p className="text-sm text-slate-100">{selectedLog.message}</p>
                  </div>
                ) : null}

                {selectedLog.user_id ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">User ID</p>
                    <code className="rounded bg-white/5 px-2 py-1 text-xs">{selectedLog.user_id}</code>
                  </div>
                ) : null}

                {selectedLog.metadata ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Metadata</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-xs">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="sm:justify-start sm:space-x-0 sm:gap-2">
                <Button
                  variant="secondary"
                  className="cursor-pointer"
                  disabled={Boolean(logActionLoading)}
                  onClick={() => void deleteLogAndOptionallyRequeue({ requeue: true })}
                >
                  {logActionLoading === "requeue" ? "İşleniyor…" : "Sil + Tekrar Kuyruğa Al"}
                </Button>
                <Button
                  variant="destructive"
                  className="cursor-pointer"
                  disabled={Boolean(logActionLoading)}
                  onClick={() => void deleteLogAndOptionallyRequeue({ requeue: false })}
                >
                  {logActionLoading === "delete" ? "Siliniyor…" : "Sadece Logu Sil"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
