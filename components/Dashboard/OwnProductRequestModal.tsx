"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { Shop } from "@/types";

type Props = {
  shop: Shop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const getCurrencyLabel = (currency: Shop["currency"]) => (currency === "TRY" ? "TRY" : "USD");

export default function OwnProductRequestModal({ shop, open, onOpenChange }: Props) {
  const { locale } = useI18n();
  const isEnglish = locale.toLowerCase().startsWith("en");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setImageFile(null);
      setImagePreviewUrl(null);
      setTitle("");
      setDescription("");
      setPrice("");
      setSubmitting(false);
    }
  }, [open, shop?.id]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  const currencyLabel = useMemo(() => getCurrencyLabel(shop?.currency ?? "USD"), [shop?.currency]);

  const handleSubmit = async () => {
    if (!shop) {
      return;
    }

    if (!imageFile) {
      toast.error(isEnglish ? "Product image is required." : "Ürün görseli zorunludur.");
      return;
    }

    if (!title.trim()) {
      toast.error(isEnglish ? "Product title is required." : "Ürün başlığı zorunludur.");
      return;
    }

    if (!description.trim()) {
      toast.error(isEnglish ? "Product description is required." : "Ürün açıklaması zorunludur.");
      return;
    }

    if (!price.trim()) {
      toast.error(isEnglish ? "Product price is required." : "Ürün fiyatı zorunludur.");
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("title", title.trim());
      formData.append("description", description.trim());
      formData.append("price", price.trim());

      const response = await fetch(`/api/stores/${shop.id}/own-product`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.error || (isEnglish ? "Own product request failed." : "Senin ürünün isteği başarısız oldu."));
      }

      toast.success(payload.message || (isEnglish ? "Request sent successfully." : "İstek başarıyla gönderildi."));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : isEnglish ? "Request failed." : "İstek başarısız oldu.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-white/10 bg-[#10131a] text-white">
        <DialogHeader>
          <DialogTitle>{isEnglish ? "Your Product" : "Senin Ürünün"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {isEnglish
              ? "Upload a reference product. We will send the image, title, description, price and store context to the AI production flow."
              : "Referans bir ürün yükleyin. Görseli, başlığı, açıklamayı, fiyatı ve mağaza bilgisini yapay zeka üretim akışına göndereceğiz."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
              {isEnglish ? "Selected Store" : "Seçili Mağaza"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-sm font-black text-indigo-200">
                {shop?.name}
              </span>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-300">
                {currencyLabel}
              </span>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-3">
              <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                {isEnglish ? "Product Image" : "Ürün Görseli"}
              </label>
              <div className="rounded-2xl border border-dashed border-white/15 bg-[#0b0f16] p-4">
                {imagePreviewUrl ? (
                  <img src={imagePreviewUrl} alt="" className="h-72 w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex h-72 flex-col items-center justify-center rounded-xl bg-white/5 text-slate-400">
                    <UploadCloud className="mb-3 h-9 w-9 text-indigo-300" />
                    <p className="text-sm font-bold">
                      {isEnglish ? "Upload a reference product image" : "Referans ürün görseli yükleyin"}
                    </p>
                  </div>
                )}
                <Input
                  type="file"
                  accept="image/*"
                  className="mt-4 cursor-pointer"
                  onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {isEnglish ? "Product Title" : "Ürün Başlığı"}
                </label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={isEnglish ? "Example: Boho crochet keychain set" : "Örnek: Boho tığ işi anahtarlık seti"}
                  maxLength={180}
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {isEnglish ? "Product Description" : "Ürün Açıklaması"}
                </label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={
                    isEnglish
                      ? "Paste the product description or explain the style you want to reproduce."
                      : "Ürün açıklamasını yapıştırın veya üretmek istediğiniz stil hakkında bilgi verin."
                  }
                  maxLength={5000}
                  className="min-h-[180px]"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {isEnglish ? "Price" : "Fiyat"} · {currencyLabel}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder={currencyLabel === "TRY" ? "1500" : "45"}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200 transition-all hover:bg-white/10 disabled:opacity-60 cursor-pointer"
          >
            {isEnglish ? "Cancel" : "Vazgeç"}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? (isEnglish ? "Sending..." : "Gönderiliyor...") : isEnglish ? "Send to AI Flow" : "AI Akışına Gönder"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
