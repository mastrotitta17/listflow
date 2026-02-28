"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type RevenuePoint = {
  monthKey: string;
  monthLabel: string;
  revenueCents: number;
  revenueAmount: number;
  transactionCount: number;
};

type RevenueTrendResponse = {
  months: number;
  mode?: "live" | "test" | "all";
  currencyFilter?: "all" | "usd" | "try";
  source?: string;
  warnings?: string[];
  currency: string;
  series: RevenuePoint[];
  seriesByCurrency?: Record<string, RevenuePoint[]>;
  totals: {
    totalVolumeCents: number;
    totalVolumeAmount: number;
    totalTransactions: number;
    currentMonthCents: number;
    currentMonthAmount: number;
    momPercent: number;
  };
  totalsByCurrency?: Record<string, {
    totalVolumeCents: number;
    totalVolumeAmount: number;
    totalTransactions: number;
    currentMonthCents: number;
    currentMonthAmount: number;
    momPercent: number;
  }>;
  error?: string;
};

type CoverageMode = "live" | "test";
type CurrencyFilter = "all" | "usd" | "try";

type SubscriptionCoverageRow = {
  source: "supabase" | "stripe" | "both";
  stripeMode: "live" | "test" | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  amountCents: number | null;
  currency: string | null;
  userId: string | null;
  userEmail: string | null;
  storeId: string | null;
  shopId: string | null;
  plan: string | null;
  interval: "month" | "year" | null;
  status: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CoverageSummary = {
  dbCount: number;
  stripeCount: number;
  mergedCount: number;
  bothCount: number;
  stripeOnlyCount: number;
  dbOnlyCount: number;
  activeOrTrialingCount: number;
};

type CoverageResponse = {
  mode: CoverageMode;
  currencyFilter?: CurrencyFilter;
  rows?: SubscriptionCoverageRow[];
  summary?: CoverageSummary;
  summaryByCurrency?: Record<string, { total: number; both: number; stripeOnly: number; dbOnly: number; activeOrTrialing: number }>;
  warnings?: string[];
  sync?: {
    scanned: number;
    upserted: number;
    failed: number;
    failures: Array<{ stripeSubscriptionId: string; reason: string }>;
  };
  error?: string;
};

type OnboardStrategy = "magic_link" | "set_password";

type OnboardLegacyResponse = {
  success?: boolean;
  email?: string;
  userId?: string;
  linkedSubscriptions?: number;
  insertedFallback?: boolean;
  actionLink?: string | null;
  emailDispatched?: boolean;
  emailDispatchError?: string | null;
  error?: string;
};

const normalizeCurrency = (currency: string | null | undefined) => (currency ?? "usd").toLowerCase();

const formatMoney = (value: number, currency: string | null | undefined = "usd") => {
  const normalized = normalizeCurrency(currency);
  const isoCurrency = normalized === "try" ? "TRY" : "USD";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: isoCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatMoneyFromCents = (cents: number | null | undefined, currency: string | null | undefined = "usd") => {
  if (typeof cents !== "number") {
    return "-";
  }

  return formatMoney(cents / 100, currency);
};

const formatMoneyTick = (value: number, currency: string | null | undefined = "usd") => {
  const normalized = normalizeCurrency(currency);
  const symbol = normalized === "try" ? "₺" : "$";
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return `${symbol}${formatted}`;
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

const getStatusVariant = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "active" || normalized === "trialing" || normalized === "paid" || normalized === "succeeded") {
    return "success" as const;
  }

  if (normalized === "canceled" || normalized === "unpaid" || normalized === "incomplete_expired" || normalized === "failed") {
    return "destructive" as const;
  }

  if (normalized === "incomplete" || normalized === "past_due" || normalized === "pending") {
    return "warning" as const;
  }

  return "secondary" as const;
};

const getSourceVariant = (source: SubscriptionCoverageRow["source"]) => {
  if (source === "both") {
    return "success" as const;
  }

  if (source === "stripe") {
    return "warning" as const;
  }

  return "secondary" as const;
};

export default function AdminSubscriptionsPage() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<RevenueTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWarnings, setTrendWarnings] = useState<string[]>([]);

  const [coverageMode, setCoverageMode] = useState<CoverageMode>("live");
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>("all");
  const [coverageRows, setCoverageRows] = useState<SubscriptionCoverageRow[]>([]);
  const [coverageSummary, setCoverageSummary] = useState<CoverageSummary | null>(null);
  const [coverageSummaryByCurrency, setCoverageSummaryByCurrency] = useState<
    Record<string, { total: number; both: number; stripeOnly: number; dbOnly: number; activeOrTrialing: number }>
  >({});
  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageSyncing, setCoverageSyncing] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageInfo, setCoverageInfo] = useState<string | null>(null);
  const [onboardDialogOpen, setOnboardDialogOpen] = useState(false);
  const [onboardSubmitting, setOnboardSubmitting] = useState(false);
  const [onboardStrategy, setOnboardStrategy] = useState<OnboardStrategy>("magic_link");
  const [onboardPassword, setOnboardPassword] = useState("");
  const [onboardTarget, setOnboardTarget] = useState<SubscriptionCoverageRow | null>(null);
  const [generatedMagicLink, setGeneratedMagicLink] = useState<string | null>(null);
  const lastTrendWarningsRef = useRef("");
  const lastCoverageWarningsRef = useRef("");

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error);
  }, [error]);

  useEffect(() => {
    if (!coverageError) {
      return;
    }

    toast.error(coverageError);
  }, [coverageError]);

  useEffect(() => {
    if (!coverageInfo) {
      return;
    }

    toast.success(coverageInfo);
  }, [coverageInfo]);

  useEffect(() => {
    const joined = trendWarnings.join(" | ").trim();
    if (!joined || joined === lastTrendWarningsRef.current) {
      return;
    }

    lastTrendWarningsRef.current = joined;
    toast.warning(joined);
  }, [trendWarnings]);

  useEffect(() => {
    const joined = coverageWarnings.join(" | ").trim();
    if (!joined || joined === lastCoverageWarningsRef.current) {
      return;
    }

    lastCoverageWarningsRef.current = joined;
    toast.warning(joined);
  }, [coverageWarnings]);

  useEffect(() => {
    let mounted = true;

    const loadRevenueTrend = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/admin/analytics/revenue-trend?months=${months}&mode=${coverageMode}&currency=${currencyFilter}`,
          {
            cache: "no-store",
          }
        );
        const payload = (await response.json()) as RevenueTrendResponse;

        if (!response.ok) {
          throw new Error(payload.error || "Revenue trend yüklenemedi.");
        }

        if (mounted) {
          setData(payload);
          setTrendWarnings(payload.warnings ?? []);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Revenue trend yüklenemedi.");
          setData(null);
          setTrendWarnings([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadRevenueTrend();

    return () => {
      mounted = false;
    };
  }, [coverageMode, currencyFilter, months]);

  const loadCoverage = useCallback(async (mode: CoverageMode, currency: CurrencyFilter) => {
    setCoverageLoading(true);
    setCoverageError(null);

    try {
      const response = await fetch(`/api/admin/analytics/subscription-coverage?mode=${mode}&currency=${currency}`, {
          cache: "no-store",
        });
      const payload = (await response.json()) as CoverageResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Subscription coverage yüklenemedi.");
      }

      setCoverageRows(payload.rows ?? []);
      setCoverageSummary(payload.summary ?? null);
      setCoverageSummaryByCurrency(payload.summaryByCurrency ?? {});
      setCoverageWarnings(payload.warnings ?? []);
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Subscription coverage yüklenemedi.");
      setCoverageRows([]);
      setCoverageSummary(null);
      setCoverageSummaryByCurrency({});
      setCoverageWarnings([]);
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage(coverageMode, currencyFilter);
  }, [coverageMode, currencyFilter, loadCoverage]);

  const runCoverageSync = async () => {
    setCoverageSyncing(true);
    setCoverageError(null);
    setCoverageInfo(null);

    try {
      const response = await fetch("/api/admin/analytics/subscription-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: coverageMode, currency: currencyFilter }),
      });
      const payload = (await response.json()) as CoverageResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Subscription sync başarısız.");
      }

      setCoverageRows(payload.rows ?? []);
      setCoverageSummary(payload.summary ?? null);
      setCoverageSummaryByCurrency(payload.summaryByCurrency ?? {});
      setCoverageWarnings(payload.warnings ?? []);

      const sync = payload.sync;
      setCoverageInfo(
        sync
          ? `Stripe tarama: ${sync.scanned}, Supabase upsert: ${sync.upserted}, hata: ${sync.failed}`
          : "Senkron tamamlandı."
      );
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Subscription sync başarısız.");
    } finally {
      setCoverageSyncing(false);
    }
  };

  const openOnboardDialog = useCallback((row: SubscriptionCoverageRow) => {
    if (!row.userEmail) {
      toast.error("Bu satır için Stripe e-posta adresi bulunamadı.");
      return;
    }

    setOnboardTarget(row);
    setOnboardStrategy("magic_link");
    setOnboardPassword("");
    setGeneratedMagicLink(null);
    setOnboardDialogOpen(true);
  }, []);

  const copyGeneratedMagicLink = useCallback(async () => {
    if (!generatedMagicLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedMagicLink);
      toast.success("Magic link panoya kopyalandı.");
    } catch {
      toast.error("Magic link kopyalanamadı. Manuel kopyalayın.");
    }
  }, [generatedMagicLink]);

  const runLegacyOnboarding = useCallback(async () => {
    if (!onboardTarget?.userEmail) {
      toast.error("Onboard için Stripe e-posta adresi gerekli.");
      return;
    }

    if (onboardStrategy === "set_password" && onboardPassword.trim().length < 8) {
      toast.error("Şifre en az 8 karakter olmalı.");
      return;
    }

    setOnboardSubmitting(true);

    try {
      const response = await fetch("/api/admin/subscriptions/onboard-legacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: onboardTarget.userEmail,
          strategy: onboardStrategy,
          password: onboardStrategy === "set_password" ? onboardPassword.trim() : undefined,
          stripeMode: onboardTarget.stripeMode,
          stripeSubscriptionId: onboardTarget.stripeSubscriptionId,
          stripeCustomerId: onboardTarget.stripeCustomerId,
          storeId: onboardTarget.storeId,
          shopId: onboardTarget.shopId,
          plan: onboardTarget.plan,
          status: onboardTarget.status,
          currentPeriodEnd: onboardTarget.currentPeriodEnd,
        }),
      });

      const payload = (await response.json()) as OnboardLegacyResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Legacy onboarding başarısız.");
      }

      const linkedCount = payload.linkedSubscriptions ?? 0;
      const fallbackInfo = payload.insertedFallback ? " (fallback insert yapıldı)" : "";
      const magicMailInfo =
        onboardStrategy === "magic_link"
          ? payload.emailDispatched
            ? " | Magic link maili gönderildi."
            : ` | Mail gönderimi başarısız: ${payload.emailDispatchError ?? "bilinmeyen hata"}. Linki manuel paylaş.`
          : "";
      toast.success(`Onboarding tamamlandı. Eşlenen abonelik: ${linkedCount}${fallbackInfo}${magicMailInfo}`);

      if (payload.actionLink) {
        setGeneratedMagicLink(payload.actionLink);
        try {
          await navigator.clipboard.writeText(payload.actionLink);
          toast.success("Magic link üretildi ve panoya kopyalandı.");
        } catch {
          toast.warning("Magic link üretildi. Elle kopyalayın.");
        }
      } else {
        setGeneratedMagicLink(null);
      }

      await loadCoverage(coverageMode, currencyFilter);

      if (onboardStrategy === "set_password") {
        setOnboardDialogOpen(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Legacy onboarding başarısız.";
      toast.error(message);
    } finally {
      setOnboardSubmitting(false);
    }
  }, [
    coverageMode,
    currencyFilter,
    loadCoverage,
    onboardPassword,
    onboardStrategy,
    onboardTarget,
  ]);

  const handleOnboardDialogOpenChange = useCallback((open: boolean) => {
    setOnboardDialogOpen(open);

    if (!open) {
      setOnboardSubmitting(false);
      setOnboardPassword("");
      setGeneratedMagicLink(null);
    }
  }, []);

  const chartCurrency = useMemo(() => {
    if (currencyFilter !== "all") {
      return currencyFilter;
    }

    const availableCurrencies = Object.keys(data?.seriesByCurrency ?? {});
    if (availableCurrencies.includes("usd")) {
      return "usd";
    }
    if (availableCurrencies.includes("try")) {
      return "try";
    }

    return availableCurrencies[0] ?? "usd";
  }, [currencyFilter, data?.seriesByCurrency]);

  const chartRows = useMemo(() => {
    if (!data) {
      return [];
    }

    if (currencyFilter === "all") {
      return data.seriesByCurrency?.[chartCurrency] ?? data.series ?? [];
    }

    return data.series ?? [];
  }, [chartCurrency, currencyFilter, data]);

  const activeTotals = useMemo(() => {
    if (!data) {
      return null;
    }

    if (currencyFilter === "all") {
      return data.totalsByCurrency?.[chartCurrency] ?? data.totals;
    }

    return data.totals;
  }, [chartCurrency, currencyFilter, data]);

  const revenueColumns = useMemo<ColumnDef<RevenuePoint>[]>(
    () => [
      { accessorKey: "monthLabel", header: "Ay" },
      {
        accessorKey: "revenueAmount",
        header: "Gelir",
        cell: ({ row }) => <span>{formatMoney(row.original.revenueAmount, chartCurrency)}</span>,
      },
      { accessorKey: "transactionCount", header: "İşlem" },
    ],
    [chartCurrency]
  );

  const coverageColumns = useMemo<ColumnDef<SubscriptionCoverageRow>[]>(
    () => [
      {
        accessorKey: "amountCents",
        header: "Abonelik Ücreti",
        cell: ({ row }) => (
          <span className="text-xs font-black text-white">
            {formatMoneyFromCents(row.original.amountCents, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => <Badge variant={getStatusVariant(row.original.status)}>{row.original.status || "-"}</Badge>,
      },
      {
        accessorKey: "source",
        header: "Kaynak",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant={getSourceVariant(row.original.source)}>{row.original.source}</Badge>
            <Badge variant="secondary">{row.original.stripeMode ?? "-"}</Badge>
          </div>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs font-black text-white">{row.original.plan || "-"}</p>
            <p className="text-xs text-slate-500">{row.original.interval || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "userEmail",
        header: "Kullanıcı",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-100 break-all">{row.original.userEmail || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.userId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "storeId",
        header: "Mağaza",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-200 break-all">{row.original.storeId || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.shopId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "stripeSubscriptionId",
        header: "Stripe Subscription",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-200 break-all">{row.original.stripeSubscriptionId || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.stripeCustomerId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "currentPeriodEnd",
        header: "Dönem Sonu",
        cell: ({ row }) => <span className="text-xs">{formatDate(row.original.currentPeriodEnd)}</span>,
      },
      {
        accessorKey: "updatedAt",
        header: "Güncellendi",
        cell: ({ row }) => <span className="text-xs">{formatDate(row.original.updatedAt || row.original.createdAt)}</span>,
      },
      {
        id: "actions",
        header: "Onboarding",
        cell: ({ row }) => {
          const hasStripeLink = Boolean(row.original.stripeSubscriptionId || row.original.stripeCustomerId);
          const canOnboard = Boolean(row.original.userEmail) && hasStripeLink;

          return (
            <Button
              size="sm"
              variant={canOnboard ? "default" : "secondary"}
              disabled={!canOnboard}
              onClick={() => openOnboardDialog(row.original)}
            >
              Onboard
            </Button>
          );
        },
      },
    ],
    [openOnboardDialog]
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <Badge className="w-fit">Revenue Analytics</Badge>
              <CardTitle>Subscriptions Gelir Trendi</CardTitle>
              <CardDescription>Ödeme geçmişine göre aylık hacim, işlem adedi ve MoM trendi.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-36">
                <Select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as CurrencyFilter)}>
                  <option value="all">All</option>
                  <option value="usd">USD</option>
                  <option value="try">TRY</option>
                </Select>
              </div>
              <div className="w-40">
                <Select value={String(months)} onChange={(event) => setMonths(Number(event.target.value))}>
                  <option value="6">Son 6 ay</option>
                  <option value="12">Son 12 ay</option>
                  <option value="18">Son 18 ay</option>
                  <option value="24">Son 24 ay</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Trend modu:</span>
            <Badge variant="secondary">{coverageMode === "live" ? "LIVE (gerçek ödeme)" : "TEST (test ödeme)"}</Badge>
            <span>Kaynak:</span>
            <Badge variant="secondary">{data?.source ?? "-"}</Badge>
            <span>Para birimi:</span>
            <Badge variant="secondary">{currencyFilter === "all" ? `ALL (${chartCurrency.toUpperCase()} chart)` : currencyFilter.toUpperCase()}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Analitik Yüklenemedi</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {trendWarnings.length ? (
            <Alert>
              <AlertTitle>Trend Uyarısı</AlertTitle>
              <AlertDescription>{trendWarnings.join(" | ")}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-80 w-full" />
            </div>
          ) : data && activeTotals ? (
            <>
              {currencyFilter === "all" && Object.keys(data.totalsByCurrency ?? {}).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(data.totalsByCurrency ?? {}).map(([currency, totals]) => (
                    <Card key={currency} className="rounded-2xl">
                      <CardHeader className="p-4">
                        <CardDescription>{currency.toUpperCase()} Toplam Hacim</CardDescription>
                        <CardTitle>{formatMoney(totals.totalVolumeAmount, currency)}</CardTitle>
                        <p className="text-xs text-slate-500">İşlem: {totals.totalTransactions}</p>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Toplam Hacim</CardDescription>
                    <CardTitle>{formatMoney(activeTotals.totalVolumeAmount, chartCurrency)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Bu Ay Gelir</CardDescription>
                    <CardTitle>{formatMoney(activeTotals.currentMonthAmount, chartCurrency)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Toplam İşlem</CardDescription>
                    <CardTitle>{activeTotals.totalTransactions}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>MoM Değişim</CardDescription>
                    <CardTitle>{activeTotals.momPercent.toFixed(2)}%</CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card className="rounded-2xl">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Aylık Gelir (Bar)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          stroke="#94a3b8"
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickFormatter={(value) => formatMoneyTick(Number(value), chartCurrency)}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#111218",
                            border: "1px solid rgba(148,163,184,0.2)",
                            borderRadius: 12,
                            color: "#fff",
                          }}
                          formatter={(value: number | string | undefined) => [
                            formatMoney(Number(value ?? 0), chartCurrency),
                            "Gelir",
                          ]}
                        />
                        <Bar dataKey="revenueAmount" name="Gelir" fill="#6366f1" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Trend Eğrisi (Line)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          stroke="#94a3b8"
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickFormatter={(value) => formatMoneyTick(Number(value), chartCurrency)}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#111218",
                            border: "1px solid rgba(148,163,184,0.2)",
                            borderRadius: 12,
                            color: "#fff",
                          }}
                          formatter={(value: number | string | undefined) => [
                            formatMoney(Number(value ?? 0), chartCurrency),
                            "Gelir",
                          ]}
                        />
                        <Line type="monotone" dataKey="revenueAmount" name="Gelir" stroke="#22d3ee" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Aylık Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <DataTable
                    columns={revenueColumns}
                    data={chartRows}
                    searchPlaceholder="Ay bazlı gelir ara..."
                    pageSize={12}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-sm text-slate-400">Veri bulunamadı.</div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-2">
              <Badge className="w-fit">Stripe + Supabase</Badge>
              <CardTitle>Abonelik Kapsamı ve Senkronizasyon</CardTitle>
              <CardDescription>
                Stripe geçmiş kayıtları ile Supabase abonelik tablosunu birleştirir, eksikleri tek tuşla Supabase&apos;e yazar.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={coverageMode} onChange={(event) => setCoverageMode(event.target.value as CoverageMode)}>
                <option value="live">Sadece Live</option>
                <option value="test">Sadece Test</option>
              </Select>
              <Select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as CurrencyFilter)}>
                <option value="all">All</option>
                <option value="usd">USD</option>
                <option value="try">TRY</option>
              </Select>
              <Button
                variant="secondary"
                onClick={() => void loadCoverage(coverageMode, currencyFilter)}
                disabled={coverageLoading || coverageSyncing}
              >
                Yenile
              </Button>
              <Button onClick={runCoverageSync} disabled={coverageLoading || coverageSyncing}>
                {coverageSyncing ? "Senkron..." : "Stripe -> Supabase Senkronize Et"}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Aktif görünüm:</span>
            <Badge variant="secondary">{coverageMode === "live" ? "LIVE (gerçek ödeme)" : "TEST (test ödeme)"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverageError ? (
            <Alert variant="destructive">
              <AlertTitle>Abonelik Senkron Hatası</AlertTitle>
              <AlertDescription>{coverageError}</AlertDescription>
            </Alert>
          ) : null}

          {coverageInfo ? (
            <Alert variant="success">
              <AlertTitle>Senkron Sonucu</AlertTitle>
              <AlertDescription>{coverageInfo}</AlertDescription>
            </Alert>
          ) : null}

          {coverageWarnings.length ? (
            <Alert>
              <AlertTitle>Uyarı</AlertTitle>
              <AlertDescription>{coverageWarnings.join(" | ")}</AlertDescription>
            </Alert>
          ) : null}

          {coverageSummary ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">DB: {coverageSummary.dbCount}</Badge>
              <Badge variant="secondary">Stripe: {coverageSummary.stripeCount}</Badge>
              <Badge variant="success">Eşleşen: {coverageSummary.bothCount}</Badge>
              <Badge variant="warning">Stripe-only: {coverageSummary.stripeOnlyCount}</Badge>
              <Badge variant="secondary">DB-only: {coverageSummary.dbOnlyCount}</Badge>
              <Badge variant="default">Aktif/Trialing: {coverageSummary.activeOrTrialingCount}</Badge>
            </div>
          ) : null}

          {currencyFilter === "all" && Object.keys(coverageSummaryByCurrency).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(coverageSummaryByCurrency).map(([currency, summary]) => (
                <Badge key={currency} variant="secondary">
                  {currency.toUpperCase()}: {summary.total} (active/trialing {summary.activeOrTrialing})
                </Badge>
              ))}
            </div>
          ) : null}

          {coverageLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : (
            <DataTable
              columns={coverageColumns}
              data={coverageRows}
              searchPlaceholder="Abonelik, kullanıcı, mağaza, plan ara..."
              pageSize={12}
              statusFilterKey="status"
              dateFilterKey="updatedAt"
              dateFilterLabel="Güncelleme Aralığı"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={onboardDialogOpen} onOpenChange={handleOnboardDialogOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Legacy Kullanıcı Onboarding</DialogTitle>
            <DialogDescription>
              Stripe-only aboneliği site kullanıcısına bağla. Magic link veya admin şifre tanımlama seçeneklerinden birini kullan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Stripe E-posta</p>
              <Input value={onboardTarget?.userEmail ?? ""} readOnly disabled />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-slate-400">Stripe Subscription</p>
              <Input value={onboardTarget?.stripeSubscriptionId ?? "-"} readOnly disabled />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-slate-400">Onboarding Yöntemi</p>
              <Select
                value={onboardStrategy}
                onChange={(event) => setOnboardStrategy(event.target.value as OnboardStrategy)}
                disabled={onboardSubmitting}
              >
                <option value="magic_link">Magic Link Üret</option>
                <option value="set_password">Şifre Belirle</option>
              </Select>
            </div>

            {onboardStrategy === "set_password" ? (
              <div className="space-y-1">
                <p className="text-xs text-slate-400">Yeni Şifre</p>
                <Input
                  type="password"
                  value={onboardPassword}
                  onChange={(event) => setOnboardPassword(event.target.value)}
                  placeholder="En az 8 karakter"
                  disabled={onboardSubmitting}
                />
              </div>
            ) : null}

            {generatedMagicLink ? (
              <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
                <p className="text-xs text-emerald-300">
                  Magic link üretildi. İstersen tekrar kopyalayabilirsin.
                </p>
                <Input value={generatedMagicLink} readOnly />
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => void copyGeneratedMagicLink()}>
                    Magic Link Kopyala
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOnboardDialogOpenChange(false)}
              disabled={onboardSubmitting}
            >
              Kapat
            </Button>
            <Button type="button" onClick={() => void runLegacyOnboarding()} disabled={onboardSubmitting || !onboardTarget?.userEmail}>
              {onboardSubmitting ? "Onboarding..." : "Onboarding'i Başlat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
