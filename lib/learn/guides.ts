import type { SupportedLocale } from "@/lib/i18n/config";

type LocalizedText = {
  tr: string;
  en: string;
};

type LocalizedTag = {
  tr: string;
  en: string;
};

export type LearnGuideSection = {
  heading: LocalizedText;
  body: LocalizedText;
  bullets: LocalizedText[];
};

export type LearnGuide = {
  slug: string;
  category: LocalizedText;
  title: LocalizedText;
  summary: LocalizedText;
  tags: LocalizedTag[];
  youtubeId: string;
  updatedAt: string;
  durationMinutes: number;
  sections: LearnGuideSection[];
};

export const learnGuides: LearnGuide[] = [
  {
    slug: "quick-start-setup",
    category: { tr: "Başlangıç", en: "Getting Started" },
    title: {
      tr: "Hızlı Kurulum: Hesap, Mağaza ve Otomasyon",
      en: "Quick Setup: Account, Store, and Automation",
    },
    summary: {
      tr: "Listflow hesabını açtıktan sonra ilk mağazanı bağlayıp otomasyonu 10 dakikada aktif etme rehberi.",
      en: "A practical guide to connect your first store and activate automation in under 10 minutes.",
    },
    tags: [
      { tr: "Kurulum", en: "Setup" },
      { tr: "Etsy", en: "Etsy" },
      { tr: "Otomasyon", en: "Automation" },
    ],
    youtubeId: "M7lc1UVf-VE",
    updatedAt: "2026-03-01",
    durationMinutes: 8,
    sections: [
      {
        heading: { tr: "1) Hesap doğrulama", en: "1) Account verification" },
        body: {
          tr: "Girişten sonra profil bilgilerini tamamla, e-posta ve 2FA durumunu doğrula. Bu adım API ve eklenti iletişimi için kritiktir.",
          en: "Complete your profile and verify email + 2FA state after sign-in. This is critical for API and extension communication.",
        },
        bullets: [
          { tr: "Ad-soyad bilgisini güncelle", en: "Update full name" },
          { tr: "2FA aktifse kod doğrulaması yap", en: "Verify 2FA code if enabled" },
          { tr: "Panel erişimini test et", en: "Validate dashboard access" },
        ],
      },
      {
        heading: { tr: "2) Mağaza oluşturma", en: "2) Store creation" },
        body: {
          tr: "Etsy otomasyonunda mağaza adı, kategori ve para birimini seç. Store ID kaydı otomasyon kuyruğunun temel anahtarıdır.",
          en: "Pick store name, category, and currency in Etsy automation. Store ID is the base key for queue and automation.",
        },
        bullets: [
          { tr: "Ana kategori + alt kategori seç", en: "Select primary + sub category" },
          { tr: "Para birimini doğrula", en: "Confirm store currency" },
          { tr: "Store ID’yi not al", en: "Keep the Store ID recorded" },
        ],
      },
    ],
  },
  {
    slug: "etsy-extension-workflow",
    category: { tr: "Eklenti", en: "Extension" },
    title: {
      tr: "Etsy Eklentisi İş Akışı",
      en: "Etsy Extension Workflow",
    },
    summary: {
      tr: "Eklenti oturum açma, worker sekmesi, checklist adımları ve publish sürecini uçtan uca açıklar.",
      en: "Covers extension login, worker tab behavior, checklist steps, and publish flow end-to-end.",
    },
    tags: [
      { tr: "Extension", en: "Extension" },
      { tr: "Publish", en: "Publish" },
      { tr: "Checklist", en: "Checklist" },
    ],
    youtubeId: "dQw4w9WgXcQ",
    updatedAt: "2026-03-01",
    durationMinutes: 12,
    sections: [
      {
        heading: { tr: "1) Worker sekmesi davranışı", en: "1) Worker tab behavior" },
        body: {
          tr: "Ürün yükleme tetiklendiğinde Etsy listing sekmesi açılır ve işlem bu sekmede yürür. Adımlar done olmadan job kapanmamalıdır.",
          en: "When upload is triggered, Etsy listing tab opens and processing runs there. Job must not finalize before all done steps.",
        },
        bullets: [
          { tr: "Category doğrulaması done olmalı", en: "Category must be confirmed done" },
          { tr: "Processing/Shipping apply adımı kontrol edilir", en: "Processing/Shipping apply state is verified" },
          { tr: "Çift publish zinciri tamamlanır", en: "Dual publish chain is completed" },
        ],
      },
      {
        heading: { tr: "2) Hata geri dönüşleri", en: "2) Recoverable errors" },
        body: {
          tr: "Etsy hata özeti görünüyorsa eksik alanlar doldurulur; publish aktifleşene kadar otomasyon devam eder.",
          en: "If Etsy error summary exists, missing fields are repaired and automation continues until publish becomes active.",
        },
        bullets: [
          { tr: "Tag, title, description kontrolü", en: "Tag, title, description checks" },
          { tr: "When made / who made doğrulaması", en: "When made / who made validation" },
          { tr: "Final publish modal onayı", en: "Final publish modal confirmation" },
        ],
      },
    ],
  },
  {
    slug: "store-activation-and-stripe",
    category: { tr: "Abonelik", en: "Subscription" },
    title: {
      tr: "Mağaza Aktivasyonu ve Stripe Akışı",
      en: "Store Activation and Stripe Flow",
    },
    summary: {
      tr: "Plan seçimi, Stripe checkout/webhook ve aktif abonelik durumlarının sistemde nasıl işlendiğini anlatır.",
      en: "Explains plan selection, Stripe checkout/webhooks, and how active subscription states are synced in the system.",
    },
    tags: [
      { tr: "Stripe", en: "Stripe" },
      { tr: "Plan", en: "Plan" },
      { tr: "Webhook", en: "Webhook" },
    ],
    youtubeId: "ysz5S6PUM-U",
    updatedAt: "2026-03-01",
    durationMinutes: 9,
    sections: [
      {
        heading: { tr: "1) Aktivasyon mantığı", en: "1) Activation logic" },
        body: {
          tr: "Checkout sonrası Stripe eventleri ile subscriptions tablosu güncellenir ve store status aktif hale gelir.",
          en: "After checkout, Stripe events update subscriptions table and store status becomes active.",
        },
        bullets: [
          { tr: "checkout.session.completed", en: "checkout.session.completed" },
          { tr: "customer.subscription.updated", en: "customer.subscription.updated" },
          { tr: "invoice.payment_succeeded", en: "invoice.payment_succeeded" },
        ],
      },
      {
        heading: { tr: "2) Faturalama döngüsü", en: "2) Billing cycle" },
        body: {
          tr: "Aylık/yıllık planlar Stripe tarafından otomatik tahsil edilir. Başarısız tahsilatlar webhook ile past_due statüsüne düşürülür.",
          en: "Monthly/yearly plans are billed automatically by Stripe. Failed invoices are reflected as past_due via webhooks.",
        },
        bullets: [
          { tr: "Plan ve interval metadata ile saklanır", en: "Plan and interval saved in metadata" },
          { tr: "DB ile Stripe durumu senkron tutulur", en: "DB is kept synchronized with Stripe status" },
          { tr: "Abonelik iptalinde durum canceled olur", en: "Cancellation updates status to canceled" },
        ],
      },
    ],
  },
  {
    slug: "order-and-shipment-ops",
    category: { tr: "Sipariş", en: "Orders" },
    title: {
      tr: "Sipariş ve Sevkiyat Operasyonları",
      en: "Order and Shipment Operations",
    },
    summary: {
      tr: "Sipariş panelinde müşteri bilgisi, ShipEntegra sevkiyat başlatma ve takip adımlarını standardize eder.",
      en: "Standardizes customer data, ShipEntegra shipment initiation, and tracking steps in the orders panel.",
    },
    tags: [
      { tr: "Order", en: "Order" },
      { tr: "ShipEntegra", en: "ShipEntegra" },
      { tr: "Shipment", en: "Shipment" },
    ],
    youtubeId: "aqz-KE-bpKQ",
    updatedAt: "2026-03-01",
    durationMinutes: 7,
    sections: [
      {
        heading: { tr: "1) Sipariş alanları", en: "1) Order fields" },
        body: {
          tr: "Ülke, şehir, ilçe ve posta kodu alanlarını doğru doldurmak quote hata oranını ciddi şekilde düşürür.",
          en: "Correct country, city, district, and postal code values significantly reduce quote failures.",
        },
        bullets: [
          { tr: "Adres satırları normalize edilir", en: "Address lines are normalized" },
          { tr: "Telefon ve e-posta doğrulanır", en: "Phone and email are validated" },
          { tr: "Kargo tipi varsayılanlarla beslenir", en: "Package defaults are applied" },
        ],
      },
    ],
  },
];

export const getLearnGuideBySlug = (slug: string) => {
  return learnGuides.find((guide) => guide.slug === slug) ?? null;
};

export const pickLocalizedText = (locale: SupportedLocale, value: LocalizedText) => {
  return locale === "en" ? value.en : value.tr;
};

export const pickLocalizedTag = (locale: SupportedLocale, value: LocalizedTag) => {
  return locale === "en" ? value.en : value.tr;
};
