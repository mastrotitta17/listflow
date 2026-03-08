"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useI18n } from "@/lib/i18n/provider";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Boxes,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

type StoreOption = {
  id: string;
  name: string;
  category: string | null;
  currency: "USD" | "TRY";
};

type ProductRow = {
  id: string;
  key: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  price: number;
  quantity: number;
  status: string;
  tags: string[];
  category: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductsResponse = {
  stores?: StoreOption[];
  selectedStoreId?: string | null;
  rows?: ProductRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  error?: string;
};

const statusTone = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (["completed", "complete", "done", "published", "uploaded", "success"].includes(normalized)) {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    return "border-red-500/25 bg-red-500/10 text-red-300";
  }

  if (["processing", "in_progress", "running", "creating"].includes(normalized)) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const ProductsPanel: React.FC = () => {
  const { t, locale } = useI18n();
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const syncServerSession = useCallback(async () => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return false;
    }

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });

    return response.ok;
  }, []);

  const loadProducts = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params = new URLSearchParams();
      if (selectedStoreId) {
        params.set("storeId", selectedStoreId);
      }
      if (searchQuery) {
        params.set("q", searchQuery);
      }
      params.set("page", String(page));

      const requestProducts = async () =>
        fetch(`/api/stores/products?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });

      try {
        let response = await requestProducts();
        let payload = (await response.json().catch(() => ({}))) as ProductsResponse;

        if (response.status === 401) {
          const synced = await syncServerSession();
          if (synced) {
            response = await requestProducts();
            payload = (await response.json().catch(() => ({}))) as ProductsResponse;
          }
        }

        if (!response.ok) {
          throw new Error(payload.error || t("productsPanel.loadError"));
        }

        const nextStores = payload.stores ?? [];
        const nextSelectedStoreId = payload.selectedStoreId ?? nextStores[0]?.id ?? "";
        setStores(nextStores);
        setSelectedStoreId((current) => (current === nextSelectedStoreId ? current : nextSelectedStoreId));
        setRows(payload.rows ?? []);
        setTotal(payload.total ?? 0);
        setPage(payload.page ?? 1);
        setTotalPages(payload.totalPages ?? 1);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : t("productsPanel.loadError");
        setError(message);
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, searchQuery, selectedStoreId, syncServerSession, t]
  );

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error);
  }, [error]);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores]
  );

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
        style: "currency",
        currency: selectedStore?.currency ?? "USD",
        maximumFractionDigits: 2,
      }),
    [locale, selectedStore?.currency]
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const handleStoreChange = (nextStoreId: string) => {
    setSelectedStoreId(nextStoreId);
    setPage(1);
  };

  const handlePrevPage = () => setPage((current) => Math.max(current - 1, 1));
  const handleNextPage = () => setPage((current) => Math.min(current + 1, totalPages));

  if (!loading && stores.length === 0) {
    return (
      <section className="p-6 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-7xl rounded-[28px] border border-white/10 bg-white/5 p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-300">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight text-white">{t("productsPanel.noStoresTitle")}</h3>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">{t("productsPanel.noStoresDescription")}</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="p-6 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.32em] text-indigo-300/80">
              {t("productsPanel.title")}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{t("productsPanel.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">{t("productsPanel.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadProducts({ silent: true })}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-slate-200 transition hover:border-indigo-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("productsPanel.refresh")}
          </button>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="w-full lg:max-w-sm">
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                {t("productsPanel.storeLabel")}
              </label>
              <Select
                value={selectedStoreId}
                onChange={(event) => handleStoreChange(event.target.value)}
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} {store.category ? `· ${store.category}` : ""}
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-full lg:max-w-md">
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                {t("common.search")}
              </label>
              <div className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0c] px-3">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t("productsPanel.searchPlaceholder")}
                  className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="lg:ml-auto">
              <div className="rounded-2xl border border-white/10 bg-[#0a0a0c] px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                  {selectedStore?.name ?? t("productsPanel.storeLabel")}
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {total} {t("productsPanel.countLabel")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-[26px] border border-white/10 bg-white/5">
                <div className="aspect-[4/3] animate-pulse bg-white/5" />
                <div className="space-y-3 p-5">
                  <div className="h-5 w-2/3 animate-pulse rounded-full bg-white/5" />
                  <div className="h-4 w-full animate-pulse rounded-full bg-white/5" />
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-600" />
            <h3 className="mt-4 text-xl font-black tracking-tight text-white">{t("productsPanel.emptyTitle")}</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">{t("productsPanel.emptyDescription")}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-[26px] border border-white/10 bg-white/5 backdrop-blur-xl transition hover:border-indigo-400/30 hover:bg-white/[0.07]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#0b1020]">
                    {row.imageUrl ? (
                      <img
                        src={row.imageUrl}
                        alt={row.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#312e81_0%,#0b1020_55%,#06070c_100%)]">
                        <Boxes className="h-10 w-10 text-indigo-300/60" />
                      </div>
                    )}
                    <div className="absolute left-4 top-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] ${statusTone(row.status)}`}>
                        {row.status}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-2 text-lg font-black tracking-tight text-white">{row.title}</h3>
                        <span className="shrink-0 text-sm font-black text-indigo-300">
                          {currencyFormatter.format(row.price)}
                        </span>
                      </div>
                      {row.description ? (
                        <p className="line-clamp-3 text-sm leading-6 text-slate-400">{row.description}</p>
                      ) : null}
                    </div>

                    <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.quantityLabel")}: {row.quantity}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.categoryLabel")}: {row.category ?? "-"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.createdLabel")}: {dateFormatter.format(new Date(row.createdAt))}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.updatedLabel")}: {dateFormatter.format(new Date(row.updatedAt))}</span>
                      </div>
                    </div>

                    {row.tags.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                          {t("productsPanel.tagsLabel")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {row.tags.slice(0, 8).map((tag) => (
                            <span
                              key={`${row.id}-${tag}`}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-sm text-slate-400">
                  {page} / {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrevPage}
                    disabled={page <= 1}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0c] text-slate-200 transition hover:border-indigo-400/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextPage}
                    disabled={page >= totalPages}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0c] text-slate-200 transition hover:border-indigo-400/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
};

export default ProductsPanel;
