"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  Trash2,
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

const DRAFT_STATUSES = ["draft", "pending", "queued"];

const statusTone = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (["completed", "complete", "done", "published", "uploaded", "success"].includes(normalized)) {
    return "border-emerald-400/40 bg-emerald-950/90 text-emerald-100 shadow-[0_8px_24px_rgba(16,185,129,0.18)]";
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    return "border-red-400/40 bg-red-950/90 text-red-100 shadow-[0_8px_24px_rgba(239,68,68,0.18)]";
  }

  if (DRAFT_STATUSES.includes(normalized)) {
    return "border-sky-300/40 bg-slate-950/95 text-sky-100 shadow-[0_8px_24px_rgba(56,189,248,0.18)]";
  }

  if (["processing", "in_progress", "running", "creating"].includes(normalized)) {
    return "border-amber-400/40 bg-amber-950/90 text-amber-100 shadow-[0_8px_24px_rgba(245,158,11,0.18)]";
  }

  return "border-slate-300/30 bg-slate-950/90 text-white shadow-[0_8px_24px_rgba(15,23,42,0.28)]";
};

const ProductsPanel: React.FC = () => {
  const { t, locale } = useI18n();
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [requeueingListingId, setRequeueingListingId] = useState<string | null>(null);
  const [removingListingId, setRemovingListingId] = useState<string | null>(null);

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

  const fetchProducts = useCallback(async (): Promise<ProductsResponse> => {
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

    return payload;
  }, [page, searchQuery, selectedStoreId, syncServerSession, t]);

  const { data, error, isLoading, isFetching, refetch } = useQuery<ProductsResponse>({
    queryKey: ["dashboard-products", selectedStoreId, searchQuery, page],
    queryFn: fetchProducts,
    placeholderData: (previousData) => previousData,
  });

  const requeueMutation = useMutation({
    mutationFn: async (args: { listingId: string; listingKey: string | null; storeId: string }) => {
      setRequeueingListingId(args.listingId);
      const response = await fetch("/api/stores/products/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          listing_id: args.listingId,
          listing_key: args.listingKey,
          store_id: args.storeId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || t("productsPanel.requeueError"));
      }

      return payload;
    },
    onSuccess: async (payload) => {
      toast.success(payload.message || t("productsPanel.requeueSuccess"));
      await refetch();
      setRequeueingListingId(null);
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : t("productsPanel.requeueError"));
      setRequeueingListingId(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (args: { listingId: string; listingKey: string | null; storeId: string }) => {
      setRemovingListingId(args.listingId);
      const response = await fetch("/api/stores/products/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          listing_id: args.listingId,
          listing_key: args.listingKey,
          store_id: args.storeId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || t("productsPanel.removeError"));
      }

      return payload;
    },
    onSuccess: async (payload) => {
      toast.success(payload.message || t("productsPanel.removeSuccess"));
      await refetch();
      setRemovingListingId(null);
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : t("productsPanel.removeError"));
      setRemovingListingId(null);
    },
  });

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error instanceof Error ? error.message : t("productsPanel.loadError"));
  }, [error, t]);

  const stores = data?.stores ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  useEffect(() => {
    const serverSelectedStoreId = data?.selectedStoreId ?? stores[0]?.id ?? "";
    if (serverSelectedStoreId && serverSelectedStoreId !== selectedStoreId) {
      setSelectedStoreId(serverSelectedStoreId);
    }
  }, [data?.selectedStoreId, selectedStoreId, stores]);

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

  if (!isLoading && stores.length === 0) {
    return (
      <section className="h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6 xl:p-8 [@media(max-height:820px)]:p-4">
        <div className="mx-auto w-full rounded-[28px] border border-white/10 bg-white/5 p-8 sm:p-10">
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
    <section className="h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6 xl:p-8 [@media(max-height:820px)]:p-4">
      <div className="w-full space-y-6">
        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 sm:p-5 [@media(max-height:820px)]:p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="w-full lg:max-w-sm">
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                {t("productsPanel.storeLabel")}
              </label>
              <Select value={selectedStoreId} onChange={(event) => handleStoreChange(event.target.value)}>
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

            <div className="lg:ml-auto flex items-end gap-3">
              <div className="rounded-2xl border border-white/10 bg-[#0a0a0c] px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">
                  {selectedStore?.name ?? t("productsPanel.storeLabel")}
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {total} {t("productsPanel.countLabel")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-slate-200 transition hover:border-indigo-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                {t("productsPanel.refresh")}
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 [@media(min-width:1850px)]:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-[22px] border border-white/10 bg-white/5">
                <div className="aspect-[4/3.5] animate-pulse bg-white/5" />
                <div className="space-y-3 p-4">
                  <div className="h-5 w-2/3 animate-pulse rounded-full bg-white/5" />
                  <div className="h-4 w-full animate-pulse rounded-full bg-white/5" />
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-600" />
            <h3 className="mt-4 text-xl font-black tracking-tight text-white">{t("productsPanel.emptyTitle")}</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">{t("productsPanel.emptyDescription")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 [@media(min-width:1850px)]:grid-cols-5">
              {rows.map((row) => (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl transition hover:border-indigo-400/30 hover:bg-white/[0.07]"
                >
                  <div className="relative aspect-[4/3.5] overflow-hidden bg-[#0b1020]">
                    {row.imageUrl ? (
                      <img src={row.imageUrl} alt={row.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#312e81_0%,#0b1020_55%,#06070c_100%)]">
                        <Boxes className="h-10 w-10 text-indigo-300/60" />
                      </div>
                    )}
                    <div className="absolute left-4 top-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] backdrop-blur-md ${statusTone(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 p-4 [@media(max-height:820px)]:space-y-2.5">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-2 text-base font-black tracking-tight text-white [@media(min-width:1700px)]:text-lg">
                          {row.title}
                        </h3>
                        <span className="shrink-0 rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-sm font-black tracking-[0.08em] text-teal-200 shadow-[0_10px_24px_rgba(20,184,166,0.18)]">
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
                        <Boxes className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.categoryLabel")}: {row.category ?? "-"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-slate-500" />
                        <span>{t("productsPanel.createdLabel")}: {dateFormatter.format(new Date(row.createdAt))}</span>
                      </div>
                    </div>

                    <div className="pt-1">
                      <div className="flex items-center justify-between w-full gap-x-2">
                        <button
                          type="button"
                          onClick={() =>
                            selectedStore
                              ? requeueMutation.mutate({
                                  listingId: row.id,
                                  listingKey: row.key,
                                  storeId: selectedStore.id,
                                })
                              : undefined
                          }
                          disabled={requeueMutation.isPending || removeMutation.isPending}
                          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/25 bg-indigo-500/10 px-3 text-xs font-black uppercase tracking-[0.2em] text-indigo-100 transition hover:border-indigo-300/50 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${requeueingListingId === row.id ? "animate-spin" : ""}`} />
                          {requeueingListingId === row.id ? t("productsPanel.requeueing") : t("productsPanel.requeue")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedStore) return;
                            const confirmed = window.confirm(t("productsPanel.removeConfirm"));
                            if (!confirmed) return;
                            removeMutation.mutate({
                              listingId: row.id,
                              listingKey: row.key,
                              storeId: selectedStore.id,
                            });
                          }}
                          disabled={requeueMutation.isPending || removeMutation.isPending}
                          title={t("productsPanel.removeLabel")}
                          aria-label={t("productsPanel.removeLabel")}
                          className="flex h-10 w-auto items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-xs font-black uppercase tracking-[0.2em] text-red-100 transition hover:border-red-300/50 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${removingListingId === row.id ? "animate-pulse" : ""}`} />
                        </button>
                      </div>
                    </div>
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
