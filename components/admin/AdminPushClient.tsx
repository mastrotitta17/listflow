"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, RefreshCw, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type PushUserRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  activeDeviceCount: number;
  lastSeenAt: string | null;
};

type PushMessageRow = {
  id: string;
  created_at: string;
  audience: string;
  title: string;
  body: string;
  deeplink_url: string | null;
  requested_count: number;
  success_count: number;
  failure_count: number;
};

type PushOverviewResponse = {
  stats?: {
    activeDevices: number;
    activeUsers: number;
    recentMessages: number;
  };
  users?: PushUserRow[];
  messages?: PushMessageRow[];
  error?: string;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function AdminPushClient() {
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deeplinkUrl, setDeeplinkUrl] = useState("");

  const overviewQuery = useQuery<PushOverviewResponse>({
    queryKey: ["admin-mobile-push"],
    queryFn: async () => {
      const response = await fetch("/api/admin/push", { credentials: "include", cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as PushOverviewResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Push verileri yüklenemedi.");
      }
      return payload;
    },
  });

  const users = overviewQuery.data?.users ?? [];
  const selectedUser = useMemo(
    () => users.find((user) => user.userId === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          audience,
          userId: audience === "user" ? selectedUserId : null,
          title,
          body,
          deeplinkUrl: deeplinkUrl.trim() || null,
          data: deeplinkUrl.trim() ? { url: deeplinkUrl.trim() } : {},
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        summary?: {
          requestedCount: number;
          successCount: number;
          failureCount: number;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error || "Push bildirimi gönderilemedi.");
      }

      return payload;
    },
    onSuccess: async (payload) => {
      toast.success(
        `${payload.message || "Gönderildi."} Toplam: ${payload.summary?.requestedCount ?? 0}, Başarılı: ${payload.summary?.successCount ?? 0}, Hata: ${payload.summary?.failureCount ?? 0}`
      );
      setTitle("");
      setBody("");
      setDeeplinkUrl("");
      await overviewQuery.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Push bildirimi gönderilemedi.");
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-white/10 bg-slate-950/80 text-white">
          <CardHeader className="pb-2">
            <CardDescription>Aktif cihaz</CardDescription>
            <CardTitle className="text-3xl">{overviewQuery.data?.stats?.activeDevices ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-white/10 bg-slate-950/80 text-white">
          <CardHeader className="pb-2">
            <CardDescription>Aktif kullanıcı</CardDescription>
            <CardTitle className="text-3xl">{overviewQuery.data?.stats?.activeUsers ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-white/10 bg-slate-950/80 text-white">
          <CardHeader className="pb-2">
            <CardDescription>Son mesaj kaydı</CardDescription>
            <CardTitle className="text-3xl">{overviewQuery.data?.stats?.recentMessages ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-white/10 bg-slate-950/80 text-white">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BellRing className="h-5 w-5 text-indigo-300" />
              Mobil Bildirim Gönder
            </CardTitle>
            <CardDescription>Expo Push üzerinden kayıtlı mobil cihazlara bildirim gönder.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-white/10 bg-transparent text-white hover:bg-white/5"
            onClick={() => void overviewQuery.refetch()}
            disabled={overviewQuery.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`} />
            Yenile
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Hedef</label>
              <Select
                value={audience}
                onChange={(event) => setAudience(event.target.value === "user" ? "user" : "all")}
              >
                <option value="all">Tüm cihazlar</option>
                <option value="user">Tek kullanıcı</option>
              </Select>
            </div>
            {audience === "user" ? (
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Kullanıcı</label>
                <Select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                >
                  <option value="">Kullanıcı seç</option>
                  {users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {`${user.fullName || user.email || user.userId} (${user.activeDeviceCount})`}
                    </option>
                  ))}
                </Select>
                {selectedUser ? (
                  <p className="text-xs text-slate-400">
                    {selectedUser.fullName || selectedUser.email || selectedUser.userId} • {selectedUser.activeDeviceCount} aktif cihaz
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Başlık</label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Örn: Yeni ürünleriniz hazır" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Deep link / URL</label>
              <Input value={deeplinkUrl} onChange={(event) => setDeeplinkUrl(event.target.value)} placeholder="https://listflow.pro/etsy-automation" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Mesaj</label>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Kullanıcının telefonda göreceği bildirim içeriği"
              className="min-h-28"
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => sendMutation.mutate()}
              disabled={
                sendMutation.isPending ||
                !title.trim() ||
                !body.trim() ||
                (audience === "user" && !selectedUserId)
              }
            >
              <Send className="mr-2 h-4 w-4" />
              {sendMutation.isPending ? "Gönderiliyor..." : "Bildirim Gönder"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-slate-950/80 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Smartphone className="h-5 w-5 text-indigo-300" />
            Son Gönderimler
          </CardTitle>
          <CardDescription>Admin panelden gönderilen son mobil bildirimler.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead>Tarih</TableHead>
                <TableHead>Hedef</TableHead>
                <TableHead>Başlık</TableHead>
                <TableHead>Sonuç</TableHead>
                <TableHead>URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overviewQuery.data?.messages ?? []).map((row) => (
                <TableRow key={row.id} className="border-white/10">
                  <TableCell>{formatDate(row.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.audience === "user" ? "Tek kullanıcı" : "Tüm cihazlar"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-semibold text-white">{row.title}</p>
                      <p className="max-w-xl text-xs text-slate-400">{row.body}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-xs">
                      <p>İstek: {row.requested_count}</p>
                      <p className="text-emerald-300">Başarılı: {row.success_count}</p>
                      <p className="text-red-300">Hata: {row.failure_count}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">{row.deeplink_url || "-"}</TableCell>
                </TableRow>
              ))}
              {!overviewQuery.isLoading && (overviewQuery.data?.messages ?? []).length === 0 ? (
                <TableRow className="border-white/10">
                  <TableCell colSpan={5} className="text-center text-sm text-slate-400">
                    Henüz bildirim gönderilmedi.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
