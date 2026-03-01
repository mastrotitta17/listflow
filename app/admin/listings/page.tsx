"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";

type ListingAdminRow = Record<string, unknown> & {
  id?: string;
  key?: string | null;
  title?: string | null;
  status?: string | null;
  listing_status?: string | null;
  derived_status?: string;
  derived_client_id?: string;
  derived_listing_url?: string;
  is_uploaded?: boolean;
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

const STATUS_OPTIONS = [
  { value: "all", label: "Tümü" },
  { value: "pending", label: "pending" },
  { value: "processing", label: "processing" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
  { value: "uploaded", label: "Yüklendi (kanıtlı)" },
  { value: "not_uploaded", label: "Yüklenmedi" },
] as const;

const fmtDate = (value: unknown) => {
  if (!value || typeof value !== "string") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR");
};

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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
  if (status === "pending") {
    return <Badge variant="secondary">pending</Badge>;
  }
  return <Badge variant="outline">{status || "-"}</Badge>;
};

const UploadBadge = ({ row }: { row: ListingAdminRow }) => {
  const uploaded = Boolean(row.is_uploaded);
  return uploaded ? <Badge variant="success">Yüklendi</Badge> : <Badge variant="destructive">Yüklenmedi</Badge>;
};

export default function AdminListingsPage() {
  const [rows, setRows] = useState<ListingAdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [requeueLoadingId, setRequeueLoadingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);

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
        header: "Store / Client ID",
        cell: ({ row }) => <span className="text-xs font-mono">{toText(row.original.derived_client_id) || "-"}</span>,
      },
      {
        accessorKey: "derived_status",
        header: "Durum",
        cell: ({ row }) => <StatusBadge row={row.original} />,
      },
      {
        accessorKey: "is_uploaded",
        header: "Etsy Yükleme",
        cell: ({ row }) => <UploadBadge row={row.original} />,
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
    [requeueLoadingId, requeueRow]
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro">
        <CardHeader>
          <CardTitle>Listing Takibi</CardTitle>
          <CardDescription>
            Eklentinin Etsy&apos;ye yüklediği ürünleri burada görebilir, gerekirse bir kaydı yeniden pending durumuna alabilirsiniz.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-52">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <Input
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              placeholder="Store/Client ID filtrele"
              className="w-56"
            />

            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ID, başlık, Etsy ID ara"
              className="w-64"
            />

            <Button onClick={() => void fetchRows()} disabled={loading}>
              {loading ? "Yükleniyor…" : "Yenile"}
            </Button>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            enableSearch={false}
            emptyMessage="Kayıt bulunamadı."
            statusFilterKey="derived_status"
            statusFilterLabel="Durum"
            dateFilterKey="updated_at"
            dateFilterLabel="Güncelleme"
          />

          <p className="text-xs text-slate-500">Toplam eşleşen kayıt: {total}</p>
        </CardContent>
      </Card>
    </div>
  );
}
