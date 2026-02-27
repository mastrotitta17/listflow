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

const LEVELS = ["all", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const fmtDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("tr-TR");
};

const LevelBadge = ({ level }: { level: string }) => {
  if (level === "error") return <Badge variant="destructive">{level}</Badge>;
  if (level === "warn") return (
    <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30">
      {level}
    </Badge>
  );
  return (
    <Badge variant="secondary" className="bg-indigo-500/15 text-indigo-400 border-indigo-500/30">
      {level}
    </Badge>
  );
};

const PAGE_SIZE = 50;

export default function ExtensionLogsPage() {
  const [logs, setLogs] = useState<ExtensionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<Level>("all");
  const [storeFilter, setStoreFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<ExtensionLog | null>(null);

  const fetchLogs = useCallback(async (reset: boolean, levelArg = levelFilter, storeArg = storeFilter, eventArg = eventFilter) => {
    setLoading(true);
    const offset = reset ? 0 : currentOffset;

    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (levelArg && levelArg !== "all") params.set("level", levelArg);
      if (storeArg.trim()) params.set("store_name", storeArg.trim());
      if (eventArg.trim()) params.set("event", eventArg.trim());

      const response = await fetch(`/api/admin/extension-logs?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(`Loglar yüklenemedi: ${(body as { error?: string }).error || response.status}`);
        return;
      }

      const body = (await response.json()) as { logs: ExtensionLog[]; has_more: boolean };
      const rows = body.logs ?? [];

      if (reset) {
        setLogs(rows);
        setCurrentOffset(rows.length);
      } else {
        setLogs((prev) => [...prev, ...rows]);
        setCurrentOffset((prev) => prev + rows.length);
      }
      setHasMore(body.has_more ?? rows.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [currentOffset, levelFilter, storeFilter, eventFilter]);

  useEffect(() => {
    void fetchLogs(true, "all", "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = async () => {
    setCurrentOffset(0);
    await fetchLogs(true, levelFilter, storeFilter, eventFilter);
  };

  const handleReset = () => {
    setLevelFilter("all");
    setStoreFilter("");
    setEventFilter("");
    setCurrentOffset(0);
    void fetchLogs(true, "all", "", "");
  };

  const columns = useMemo<ColumnDef<ExtensionLog>[]>(() => [
    {
      accessorKey: "created_at",
      header: "Tarih",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {fmtDate(row.original.created_at)}
        </span>
      ),
    },
    {
      accessorKey: "level",
      header: "Seviye",
      cell: ({ row }) => <LevelBadge level={row.original.level} />,
    },
    {
      accessorKey: "store_name",
      header: "Mağaza",
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.store_name || row.original.store_id || "-"}
        </span>
      ),
    },
    {
      accessorKey: "event",
      header: "Olay",
      cell: ({ row }) => (
        <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">{row.original.event}</code>
      ),
    },
    {
      accessorKey: "message",
      header: "Mesaj",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground line-clamp-2 max-w-xs">
          {row.original.message || "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2"
          onClick={() => setSelectedLog(row.original)}
        >
          Detay
        </Button>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro">
        <CardHeader>
          <CardTitle>Eklenti Logları</CardTitle>
          <CardDescription>
            Chrome eklentisinden gelen tüm loglar — hata, uyarı ve bilgi olayları.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as Level)}
              className="w-32"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l === "all" ? "Tümü" : l}
                </option>
              ))}
            </Select>

            <Input
              placeholder="Mağaza adı filtrele..."
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="w-48"
            />

            <Input
              placeholder="Olay filtrele..."
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="w-48"
            />

            <Button onClick={handleFilter} disabled={loading} size="sm">
              {loading ? "Yükleniyor…" : "Filtrele"}
            </Button>

            <Button variant="secondary" size="sm" onClick={handleReset} disabled={loading}>
              Temizle
            </Button>
          </div>

          {/* Table */}
          <DataTable
            columns={columns}
            data={logs}
          />

          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchLogs(false)}
                disabled={loading}
              >
                {loading ? "Yükleniyor…" : "Daha Fazla Yükle"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Detail panel */}
      {selectedLog ? (
        <Card className="glass-card-pro">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <LevelBadge level={selectedLog.level} />
                <code className="text-sm">{selectedLog.event}</code>
              </CardTitle>
              <CardDescription className="mt-1">
                {fmtDate(selectedLog.created_at)}
                {selectedLog.store_name ? ` · ${selectedLog.store_name}` : ""}
                {selectedLog.store_id ? ` (${selectedLog.store_id})` : ""}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedLog(null)}>
              ✕
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedLog.message ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Mesaj</p>
                <p className="text-sm">{selectedLog.message}</p>
              </div>
            ) : null}

            {selectedLog.user_id ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">User ID</p>
                <code className="text-xs bg-white/5 px-2 py-1 rounded">{selectedLog.user_id}</code>
              </div>
            ) : null}

            {selectedLog.metadata ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Metadata</p>
                <pre className="text-xs bg-white/5 p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                  {JSON.stringify(selectedLog.metadata, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
