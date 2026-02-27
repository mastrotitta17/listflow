"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabaseClient';
import {
  Package,
  Send,
  Search,
  Filter,
  MapPin,
  Calendar,
  CreditCard,
  PlayCircle,
  Tag,
  FileText,
  Hash,
  CheckCircle2,
  Clock,
  Loader2,
  Link as LinkIcon,
  Layers,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { useCategoriesRepository } from '@/lib/repositories/categories';
import { useOrdersRepository } from '@/lib/repositories/orders';
import { toast } from 'sonner';
import { Select } from '@/components/ui/select';

type GeoCountryOption = {
  code: string;
  name: string;
};

type GeoStateOption = {
  code: string;
  name: string;
};

type GeoCityOption = {
  name: string;
};

type FilterStatus = 'all' | 'paid' | 'unpaid';

type FilterDropdownProps = {
  value: FilterStatus;
  onChange: (v: FilterStatus) => void;
  open: boolean;
  onToggle: () => void;
  locale: string;
  filterLabel: string;
};

const FilterDropdown: React.FC<FilterDropdownProps> = ({ value, onChange, open, onToggle, locale, filterLabel }) => {
  const ref = useRef<HTMLDivElement>(null);
  const isEn = locale === 'en';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onToggle]);

  const options: { value: FilterStatus; label: string }[] = [
    { value: 'all',    label: isEn ? 'All Orders'    : 'Tüm Siparişler'   },
    { value: 'paid',   label: isEn ? 'Paid'          : 'Ödendi'           },
    { value: 'unpaid', label: isEn ? 'Unpaid'        : 'Ödenmedi'         },
  ];

  const activeLabel = options.find((o) => o.value === value)?.label ?? filterLabel;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        className={`px-5 py-3 rounded-2xl glass border flex items-center gap-2 font-bold text-xs hover:bg-zinc-100 dark:hover:bg-white/5 transition-all uppercase tracking-wider cursor-pointer ${
          value !== 'all'
            ? 'border-indigo-500/60 text-indigo-400 dark:text-indigo-400'
            : 'border-zinc-200 dark:border-white/10'
        }`}
      >
        <Filter className="w-4 h-4" />
        {value !== 'all' ? activeLabel : filterLabel}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-44 rounded-2xl border border-white/10 bg-[#0d111b] shadow-[0_16px_48px_rgba(5,10,28,0.8)] overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`w-full text-left px-4 py-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-between ${
                value === opt.value
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {opt.label}
              {value === opt.value && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const OrdersPanel: React.FC = () => {
  const { orders, loading, error, createOrder, deleteOrder } = useOrdersRepository();
  const [showModal, setShowModal] = useState(false);
  const { t, locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<{ id: string; label: string } | null>(null);

  const [selectedCatId, setSelectedCatId] = useState(categories[0]?.id ?? '');
  const [selectedSubId, setSelectedSubId] = useState('');
  const [selectedVarId, setSelectedVarId] = useState('');
  const [productLink, setProductLink] = useState('');
  const [address, setAddress] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receiverCountryCode, setReceiverCountryCode] = useState(locale === 'tr' ? 'TR' : 'US');
  const [receiverState, setReceiverState] = useState('');
  const [receiverCity, setReceiverCity] = useState('');
  const [receiverTown, setReceiverTown] = useState('');
  const [receiverPostalCode, setReceiverPostalCode] = useState('');
  const [note, setNote] = useState('');
  const [ioss, setIoss] = useState('');
  const [labelNumber, setLabelNumber] = useState('');
  const [storeOptions, setStoreOptions] = useState<Array<{ id: string; name: string; category: string | null }>>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [storeOptionsLoading, setStoreOptionsLoading] = useState(false);
  const [storeOptionsError, setStoreOptionsError] = useState<string | null>(null);
  const [countryOptions, setCountryOptions] = useState<GeoCountryOption[]>([]);
  const [stateOptions, setStateOptions] = useState<GeoStateOption[]>([]);
  const [cityOptions, setCityOptions] = useState<GeoCityOption[]>([]);
  const [geoLoadingCountries, setGeoLoadingCountries] = useState(false);
  const [geoLoadingStates, setGeoLoadingStates] = useState(false);
  const [geoLoadingCities, setGeoLoadingCities] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error);
  }, [error]);

  useEffect(() => {
    if (!storeOptionsError) {
      return;
    }

    toast.error(storeOptionsError);
  }, [storeOptionsError]);

  useEffect(() => {
    if (!geoError) {
      return;
    }

    toast.error(geoError);
  }, [geoError]);

  const currentCategory = useMemo(() => categories.find((category) => category.id === selectedCatId), [categories, selectedCatId]);
  const currentSubProduct = useMemo(() => currentCategory?.subProducts.find((subProduct) => subProduct.id === selectedSubId), [currentCategory, selectedSubId]);
  const currentVariation = useMemo(() => currentSubProduct?.variations?.find((variation) => variation.id === selectedVarId), [currentSubProduct, selectedVarId]);

  const loadStoreOptions = useCallback(async () => {
    setStoreOptionsLoading(true);
    setStoreOptionsError(null);

    try {
      const response = await fetch('/api/stores/overview', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      });

      const payload = (await response.json().catch(() => ({}))) as {
        rows?: Array<{ id?: string; storeName?: string; category?: string | null }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || t('orders.storeLoadFailed'));
      }

      const nextOptions = (payload.rows ?? [])
        .filter((row): row is { id: string; storeName: string; category: string | null } => Boolean(row.id && row.storeName))
        .map((row) => ({
          id: row.id,
          name: row.storeName,
          category: row.category ?? null,
        }));

      setStoreOptions(nextOptions);
      setSelectedStoreId((prev) => {
        if (prev && nextOptions.some((store) => store.id === prev)) {
          return prev;
        }

        if (nextOptions.length === 1) {
          return nextOptions[0].id;
        }

        return '';
      });
    } catch (loadError) {
      setStoreOptions([]);
      setStoreOptionsError(loadError instanceof Error ? loadError.message : t('orders.storeLoadFailed'));
    } finally {
      setStoreOptionsLoading(false);
    }
  }, [t]);

  const loadCountryOptions = useCallback(async () => {
    setGeoLoadingCountries(true);
    setGeoError(null);

    try {
      const response = await fetch('/api/geo/countries', {
        method: 'GET',
        cache: 'force-cache',
      });

      const payload = (await response.json().catch(() => ({}))) as {
        rows?: GeoCountryOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || (locale === 'en' ? 'Countries could not be loaded.' : 'Ülke listesi yüklenemedi.'));
      }

      setCountryOptions(payload.rows ?? []);
    } catch (loadError) {
      setCountryOptions([]);
      setGeoError(loadError instanceof Error ? loadError.message : (locale === 'en' ? 'Countries could not be loaded.' : 'Ülke listesi yüklenemedi.'));
    } finally {
      setGeoLoadingCountries(false);
    }
  }, [locale]);

  const loadStateOptions = useCallback(async (countryCode: string) => {
    setGeoLoadingStates(true);
    setGeoError(null);

    try {
      const response = await fetch(`/api/geo/states?country=${encodeURIComponent(countryCode)}`, {
        method: 'GET',
        cache: 'force-cache',
      });

      const payload = (await response.json().catch(() => ({}))) as {
        rows?: GeoStateOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || (locale === 'en' ? 'States could not be loaded.' : 'Eyalet listesi yüklenemedi.'));
      }

      setStateOptions(payload.rows ?? []);
      return payload.rows ?? [];
    } catch (loadError) {
      setStateOptions([]);
      setGeoError(loadError instanceof Error ? loadError.message : (locale === 'en' ? 'States could not be loaded.' : 'Eyalet listesi yüklenemedi.'));
      return [];
    } finally {
      setGeoLoadingStates(false);
    }
  }, [locale]);

  const loadCityOptions = useCallback(async (args: { countryCode: string; stateCode?: string }) => {
    setGeoLoadingCities(true);
    setGeoError(null);

    try {
      const query = new URLSearchParams({
        country: args.countryCode,
        limit: '5000',
      });

      if (args.stateCode) {
        query.set('state', args.stateCode);
      }

      const response = await fetch(`/api/geo/cities?${query.toString()}`, {
        method: 'GET',
        cache: 'force-cache',
      });

      const payload = (await response.json().catch(() => ({}))) as {
        rows?: GeoCityOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || (locale === 'en' ? 'Cities could not be loaded.' : 'Şehir listesi yüklenemedi.'));
      }

      setCityOptions(payload.rows ?? []);
      return payload.rows ?? [];
    } catch (loadError) {
      setCityOptions([]);
      setGeoError(loadError instanceof Error ? loadError.message : (locale === 'en' ? 'Cities could not be loaded.' : 'Şehir listesi yüklenemedi.'));
      return [];
    } finally {
      setGeoLoadingCities(false);
    }
  }, [locale]);

  const hydrateGeoByCountry = useCallback(async (countryCode: string) => {
    const normalizedCountryCode = countryCode.trim().toUpperCase();

    if (!normalizedCountryCode) {
      setStateOptions([]);
      setCityOptions([]);
      return;
    }

    const states = await loadStateOptions(normalizedCountryCode);

    if (states.length > 0) {
      setCityOptions([]);
      return;
    }

    await loadCityOptions({ countryCode: normalizedCountryCode });
  }, [loadCityOptions, loadStateOptions]);

  useEffect(() => {
    if (categories.length === 0) {
      if (selectedCatId) {
        setSelectedCatId('');
        setSelectedSubId('');
        setSelectedVarId('');
      }
      return;
    }

    const selectedCategoryStillExists = categories.some((category) => category.id === selectedCatId);

    if (!selectedCatId || !selectedCategoryStillExists) {
      setSelectedCatId(categories[0].id);
      setSelectedSubId('');
      setSelectedVarId('');
    }
  }, [categories, selectedCatId]);

  useEffect(() => {
    if (!showModal) {
      return;
    }

    void loadStoreOptions();
    if (countryOptions.length === 0) {
      void loadCountryOptions();
    }
    void hydrateGeoByCountry(receiverCountryCode);
  }, [countryOptions.length, hydrateGeoByCountry, loadCountryOptions, loadStoreOptions, receiverCountryCode, showModal]);

  const handleCountryChange = (nextCountryCode: string) => {
    const normalizedCountryCode = nextCountryCode.trim().toUpperCase();
    setReceiverCountryCode(normalizedCountryCode);
    setReceiverState('');
    setReceiverCity('');
    setReceiverTown('');
    void hydrateGeoByCountry(normalizedCountryCode);
  };

  const handleStateChange = (nextStateCode: string) => {
    setReceiverState(nextStateCode);
    setReceiverCity('');
    setReceiverTown('');
    void loadCityOptions({
      countryCode: receiverCountryCode,
      stateCode: nextStateCode || undefined,
    });
  };

  const handleCityChange = (nextCity: string) => {
    setReceiverCity(nextCity);
    setReceiverTown((previousValue) => previousValue || nextCity);
  };

  const calculatedPrice = useMemo(() => {
    const baseMaliyet = currentVariation?.maliyet ?? currentSubProduct?.maliyet ?? 0;
    return baseMaliyet + 1.5;
  }, [currentSubProduct, currentVariation]);

  const filteredOrders = useMemo(() => {
    let result = orders;

    // Status filter
    if (filterStatus === 'paid') {
      result = result.filter((order) => order.isPaid);
    } else if (filterStatus === 'unpaid') {
      result = result.filter((order) => !order.isPaid);
    }

    // Search filter
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      result = result.filter((order) =>
        [
          order.productName,
          order.subProductName,
          order.variantName,
          order.category,
          order.address,
          order.labelNumber,
          order.productLink,
          order.receiverName,
          order.receiverCity,
          order.note,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term))
      );
    }

    return result;
  }, [orders, searchTerm, filterStatus]);

  const handleSendOrder = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!currentCategory || !currentSubProduct) {
      toast.error('Kategori ve ürün seçimi zorunlu.');
      return;
    }

    const resolvedStoreId =
      selectedStoreId || (storeOptions.length === 1 ? storeOptions[0].id : '');

    if (!resolvedStoreId) {
      toast.error(t('orders.storeRequired'));
      return;
    }

    const resolvedReceiverTown = receiverTown.trim() || receiverCity.trim();

    if (!receiverName.trim() || !receiverPhone.trim() || !receiverCountryCode.trim() || !receiverCity.trim() || !resolvedReceiverTown || !receiverPostalCode.trim()) {
      toast.error(locale === 'en' ? 'Receiver details are required for shipment.' : 'Navlungo sevkiyatı için alıcı bilgileri zorunludur.');
      return;
    }

    if (currentSubProduct.variations?.length && !selectedVarId) {
      toast.error(locale === 'en' ? 'Please select a variation.' : 'Lütfen bir varyasyon seçin.');
      return;
    }

    setIsSubmitting(true);

    try {
      const createResult = await createOrder({
        storeId: resolvedStoreId,
        category: currentCategory.name,
        subProductName: currentSubProduct.name,
        variantName: currentVariation?.name ?? null,
        productLink,
        date: new Date().toISOString().split('T')[0],
        address,
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverCountryCode: receiverCountryCode.trim().toUpperCase(),
        receiverState: receiverState.trim() || undefined,
        receiverCity: receiverCity.trim(),
        receiverTown: resolvedReceiverTown,
        receiverPostalCode: receiverPostalCode.trim(),
        note,
        ioss,
        labelNumber,
        price: calculatedPrice,
      });

      setAddress('');
      setReceiverName('');
      setReceiverPhone('');
      setReceiverCountryCode(locale === 'tr' ? 'TR' : 'US');
      setReceiverState('');
      setReceiverCity('');
      setReceiverTown('');
      setStateOptions([]);
      setCityOptions([]);
      setReceiverPostalCode('');
      setNote('');
      setIoss('');
      setLabelNumber('');
      setSelectedSubId('');
      setSelectedVarId('');
      setProductLink('');
      if (storeOptions.length > 1) {
        setSelectedStoreId('');
      }
      setShowModal(false);
      toast.success(locale === 'en' ? 'Order created successfully.' : 'Sipariş başarıyla oluşturuldu.');

      if (createResult.navlungo?.status === 'started') {
        toast.success(
          locale === 'en'
            ? 'Shipping process has started in the background via Navlungo.'
            : 'Sevkiyat süreci arka planda Navlungo üzerinden başlatıldı.'
        );
      } else if (createResult.navlungo?.status === 'failed') {
        toast.error(createResult.navlungo.message || (locale === 'en' ? 'Navlungo shipment start failed.' : 'Navlungo sevkiyatı başlatılamadı.'));
      } else if (createResult.navlungo?.status === 'skipped' && createResult.navlungo.message) {
        toast.message(createResult.navlungo.message);
      }
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Sipariş kaydedilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayment = async (orderId: string) => {
    try {
      const order = orders.find((item) => item.id === orderId);
      if (!order) {
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Oturum bulunamadı.');
      }

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'payment',
          amount: order.price,
          shopId: `order_${orderId}`,
          orderId,
          plan: 'standard',
        }),
      });

      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Ödeme linki alınamadı.');
      }

      window.location.href = data.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ödeme başlatılamadı.';
      toast.error(message);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteTargetOrder) {
      return;
    }

    setDeletingOrderId(deleteTargetOrder.id);

    try {
      await deleteOrder(deleteTargetOrder.id);
      setDeleteTargetOrder(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('orders.deleteFailed');
      toast.error(message);
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div className="w-full p-5 h-full flex flex-col">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t('orders.title')}</h1>
          <p className="text-zinc-500 text-sm font-medium">{t('orders.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center gap-3 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 transition-all shadow-xl cursor-pointer"
        >
          <Send className="w-5 h-5" /> {t('orders.sendOrder')}
        </button>
      </div>

      <div className="flex gap-4 mb-6 shrink-0">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-3 w-5 h-5 text-zinc-400" />
          <input
            type="text"
            placeholder={t('orders.searchPlaceholder')}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
          />
        </div>
        <FilterDropdown
          value={filterStatus}
          onChange={(v) => { setFilterStatus(v); setFilterOpen(false); }}
          open={filterOpen}
          onToggle={() => setFilterOpen((prev) => !prev)}
          locale={locale}
          filterLabel={t('orders.filter')}
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 p-5 custom-scrollbar">
        {error && (
          <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-16 glass rounded-[32px] text-center border-2 border-dashed border-zinc-200 dark:border-white/10">
            <p className="text-zinc-400 font-medium">{t('common.loading')}...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-16 glass rounded-[32px] text-center border-2 border-dashed border-zinc-200 dark:border-white/10">
            <p className="text-zinc-400 font-medium">{t('orders.empty')}</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative p-5 rounded-[28px] glass-card border border-zinc-200 dark:border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:shadow-lg transition-all group"
            >
              <button
                type="button"
                onClick={() =>
                  setDeleteTargetOrder({
                    id: order.id,
                    label: order.variantName ? `${order.subProductName} (${order.variantName})` : order.subProductName,
                  })
                }
                disabled={deletingOrderId === order.id}
                aria-label={t('orders.delete')}
                className="absolute -top-3 -right-3 z-20 h-8 w-8 rounded-full border border-red-200/80 bg-white text-red-500 shadow-md hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-900 dark:border-red-400/30 cursor-pointer"
              >
                <X className="mx-auto h-4 w-4" />
              </button>

              <div className="flex items-center gap-5 flex-1">
                <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center shrink-0">
                  <Package className="w-7 h-7 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black truncate">
                    {order.subProductName}
                    {order.variantName ? ` (${order.variantName})` : ''}
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 font-bold uppercase tracking-wider mt-1">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {order.date}</span>
                    <span className="flex items-center gap-1.5 text-indigo-500"><Tag className="w-3.5 h-3.5" /> {order.labelNumber}</span>
                    <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {order.address.length > 30 ? `${order.address.substring(0, 30)}...` : order.address}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-black text-zinc-400 uppercase tracking-widest mb-0.5">{t('orders.total')}</p>
                  <p className="font-black text-indigo-400 text-lg">${order.price.toFixed(2)}</p>
                </div>

                <div className="flex items-center gap-3">
                  {order.isPaid ? (
                    <div className="px-4 py-2 rounded-xl bg-green-500/10 text-green-600 text-lg font-black uppercase tracking-wider flex items-center gap-2">
                      <CheckCircle2 className="w-6 h-6" />
                      {t('orders.paid')}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="px-4 py-2 rounded-xl bg-orange-500/10 text-orange-600 text-lg font-semibold uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-6 h-6" />
                        {t('orders.pending')}
                      </div>
                      <button
                        onClick={() => handlePayment(order.id)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-lg font-semibold uppercase tracking-wider flex items-center gap-2 hover:scale-105 transition-all shadow-md cursor-pointer"
                      >
                        <CreditCard className="w-6 h-6" />
                        {t('orders.pay')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      <AnimatePresence>
        {deleteTargetOrder && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => deletingOrderId === null && setDeleteTargetOrder(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg p-8 rounded-[32px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2">{t('orders.deleteConfirmTitle')}</h3>
              <p className="text-slate-300 text-sm mb-6">{t('orders.deleteConfirm')}</p>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white mb-6">
                {deleteTargetOrder.label}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTargetOrder(null)}
                  disabled={deletingOrderId === deleteTargetOrder.id}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t('orders.deleteCancel')}
                </button>
                <button
                  onClick={() => void handleConfirmDeleteOrder()}
                  disabled={deletingOrderId === deleteTargetOrder.id}
                  className="flex-1 py-3 rounded-xl bg-red-600/90 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deletingOrderId === deleteTargetOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t('orders.deleteApprove')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="relative w-full max-w-4xl p-6 lg:p-10 rounded-[40px] glass-card shadow-2xl overflow-y-auto max-h-full custom-scrollbar bg-[#0a0a0c]"
            >
              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/30">
                  <Send className="text-white w-6 h-6" />
                </div>
                <h2 className="text-3xl font-black tracking-tight">{t('orders.newOrder')}</h2>
              </div>

              <form onSubmit={handleSendOrder} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">{t('orders.storeLabel')}</label>
                    <Select
                      value={selectedStoreId}
                      onChange={(event) => setSelectedStoreId(event.target.value)}
                      disabled={storeOptionsLoading || storeOptions.length === 0}
                      className="h-[54px] rounded-2xl disabled:opacity-60"
                    >
                      <option value="">
                        {storeOptionsLoading ? t('orders.storeLoading') : t('orders.storePlaceholder')}
                      </option>
                      {storeOptions.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </Select>
                    {storeOptionsError ? <p className="text-[10px] text-red-400 px-1">{storeOptionsError}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Kategori Seç</label>
                    <Select
                      value={selectedCatId}
                      onChange={(event) => {
                        setSelectedCatId(event.target.value);
                        setSelectedSubId('');
                        setSelectedVarId('');
                      }}
                      className="h-[54px] rounded-2xl"
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Ürün Seç</label>
                    <Select
                      value={selectedSubId}
                      onChange={(event) => {
                        setSelectedSubId(event.target.value);
                        setSelectedVarId('');
                      }}
                      className="h-[54px] rounded-2xl"
                    >
                      <option value="">Seçiniz...</option>
                      {currentCategory?.subProducts.map((subProduct) => (
                        <option key={subProduct.id} value={subProduct.id}>{subProduct.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className={`space-y-2 transition-opacity duration-300 ${currentSubProduct?.variations ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Varyasyon / Boyut</label>
                    <div className="relative">
                      <Layers className="pointer-events-none absolute left-4 top-4 w-4 h-4 text-zinc-400" />
                      <Select
                        value={selectedVarId}
                        onChange={(event) => setSelectedVarId(event.target.value)}
                        className="h-[54px] rounded-2xl pl-10"
                      >
                        <option value="">Varyasyon...</option>
                        {currentSubProduct?.variations?.map((variation) => (
                          <option key={variation.id} value={variation.id}>{variation.name}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Ürün Etsy Linki (Zorunlu)</label>
                  <div className="relative">
                    <LinkIcon className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                    <input
                      required
                      type="url"
                      value={productLink}
                      onChange={(e) => setProductLink(e.target.value)}
                      placeholder="https://www.etsy.com/listing/..."
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Teslimat Adresi</label>
                  <textarea
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={2}
                    placeholder={locale === 'en' ? 'Street address: House no, street, apartment...' : 'Sokak adresi: Ev no, sokak, daire...'}
                    className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm resize-none"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 space-y-4">
                  <p className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.24em]">
                    {locale === 'en' ? 'Navlungo Receiver Details' : 'Navlungo Alıcı Bilgileri'}
                  </p>
                  <p className="text-[11px] text-indigo-200/80">
                    {locale === 'en'
                      ? 'Enter receiver details according to destination country for global shipping.'
                      : 'Dünya geneli gönderim için alıcı bilgilerini hedef ülkeye uygun girin.'}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'Receiver Name' : 'Alıcı Ad Soyad'}
                      </label>
                      <input
                        required
                        value={receiverName}
                        onChange={(e) => setReceiverName(e.target.value)}
                        type="text"
                        placeholder={locale === 'en' ? 'John Doe' : 'Mehmet Demir'}
                        className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'Receiver Phone' : 'Alıcı Telefon'}
                      </label>
                      <input
                        required
                        value={receiverPhone}
                        onChange={(e) => setReceiverPhone(e.target.value)}
                        type="text"
                        placeholder="+905551112233"
                        className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'Country (ISO2)' : 'Ülke (ISO2)'}
                      </label>
                      <Select
                        value={receiverCountryCode}
                        onChange={(event) => handleCountryChange(event.target.value)}
                        disabled={geoLoadingCountries}
                        className="h-[54px] rounded-2xl"
                      >
                        <option value="">{geoLoadingCountries ? (locale === 'en' ? 'Loading countries...' : 'Ülkeler yükleniyor...') : (locale === 'en' ? 'Select country...' : 'Ülke seçin...')}</option>
                        {countryOptions.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name} ({country.code})
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'State' : 'Eyalet / Bölge'}
                      </label>
                      {stateOptions.length > 0 ? (
                        <Select
                          value={receiverState}
                          onChange={(event) => handleStateChange(event.target.value)}
                          disabled={geoLoadingStates}
                          className="h-[54px] rounded-2xl"
                        >
                          <option value="">
                            {geoLoadingStates
                              ? (locale === 'en' ? 'Loading states...' : 'Eyaletler yükleniyor...')
                              : (locale === 'en' ? 'Select state...' : 'Eyalet seçin...')}
                          </option>
                          {stateOptions.map((stateOption) => (
                            <option key={stateOption.code} value={stateOption.code}>
                              {stateOption.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <input
                          value={receiverState}
                          onChange={(e) => setReceiverState(e.target.value)}
                          type="text"
                          placeholder={locale === 'en' ? 'NY' : 'Marmara'}
                          className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'City' : 'Şehir'}
                      </label>
                      {cityOptions.length > 0 ? (
                        <Select
                          value={receiverCity}
                          onChange={(event) => handleCityChange(event.target.value)}
                          disabled={geoLoadingCities || (stateOptions.length > 0 && !receiverState)}
                          className="h-[54px] rounded-2xl"
                        >
                          <option value="">
                            {geoLoadingCities
                              ? (locale === 'en' ? 'Loading cities...' : 'Şehirler yükleniyor...')
                              : stateOptions.length > 0 && !receiverState
                                ? (locale === 'en' ? 'Select state first...' : 'Önce eyalet seçin...')
                                : (locale === 'en' ? 'Select city...' : 'Şehir seçin...')}
                          </option>
                          {cityOptions.map((city) => (
                            <option key={city.name} value={city.name}>
                              {city.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <input
                          required
                          value={receiverCity}
                          onChange={(e) => setReceiverCity(e.target.value)}
                          type="text"
                          placeholder={locale === 'en' ? 'Istanbul' : 'İstanbul'}
                          className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'Town / District' : 'İlçe'}
                      </label>
                      <input
                        required
                        value={receiverTown}
                        onChange={(e) => setReceiverTown(e.target.value)}
                        type="text"
                        placeholder={locale === 'en' ? 'Brooklyn' : 'Şişli'}
                        className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                        {locale === 'en' ? 'Postal Code' : 'Posta Kodu'}
                      </label>
                      <input
                        required
                        value={receiverPostalCode}
                        onChange={(e) => setReceiverPostalCode(e.target.value)}
                        type="text"
                        placeholder="34000"
                        className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Etiket Numarası (Zorunlu)</label>
                    <a href="#" className="flex items-center gap-1 text-[10px] text-indigo-500 font-bold hover:underline">
                      <PlayCircle className="w-3 h-3" /> İzle
                    </a>
                  </div>
                  <div className="relative">
                    <Hash className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                    <input
                      required
                      value={labelNumber}
                      onChange={(e) => setLabelNumber(e.target.value)}
                      type="text"
                      placeholder="TR123456789"
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 italic mt-1 px-1">
                    * Videoyu izleyerek nasıl kargo takip oluşturacağınızı öğrenebilirsiniz.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">IOSS / UK VAT (Varsa)</label>
                    <div className="relative">
                      <FileText className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                      <input
                        value={ioss}
                        onChange={(e) => setIoss(e.target.value)}
                        type="text"
                        placeholder="IOSS-1234..."
                        className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Sipariş Notu / Açıklama</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      type="text"
                      placeholder="Hediye, renk tercihi vb."
                      className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-[28px] bg-indigo-600/5 dark:bg-white/5 border border-indigo-200 dark:border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Maliyet</span>
                    <span className="font-bold">${(currentVariation?.maliyet ?? currentSubProduct?.maliyet ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">İşlem Ücreti</span>
                    <span className="font-bold">$1.50</span>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-white/10">
                    <span className="text-sm font-black uppercase tracking-widest">{t('orders.amountDue')}</span>
                    <span className="text-2xl font-black text-indigo-600">${calculatedPrice.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 py-4 rounded-2xl glass border border-zinc-200 dark:border-white/10 font-black text-sm uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-white/5 transition-all cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-5 h-5" /> {isSubmitting ? `${t('common.loading')}...` : t('orders.confirmOrder')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrdersPanel;
