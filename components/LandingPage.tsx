"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Globe2,
  Layers,
  Package,
  Rocket,
  Menu,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type FeatureCard = {
  icon: LucideIcon;
  title: string;
  desc: string;
  badge: string;
};

type LandingCopy = {
  heroPointA: string;
  heroPointB: string;
  trustTitle: string;
  trustItems: string[];
  metricCards: Array<{ value: string; label: string }>;
  featureTitle: string;
  featureSubtitle: string;
  howTitle: string;
  howSubtitle: string;
  howSteps: Array<{ title: string; desc: string }>;
  plansTitle: string;
  plansSubtitle: string;
  plans: Array<{
    name: string;
    cadence: string;
    detail: string;
    highlights: string[];
  }>;
  finalTitle: string;
  finalSubtitle: string;
  finalPrimaryCta: string;
  finalSecondaryCta: string;
  cardControlTitle: string;
  cardControlSubtitle: string;
  cardRows: Array<{ store: string; status: string; eta: string }>;
};

const coreFeatureIcons: LucideIcon[] = [Layers, Braces, Package, Globe2];
const extraFeatureIcons: LucideIcon[] = [ShieldCheck, Workflow];

const LandingPage: React.FC = () => {
  const router = useRouter();
  const { t, messages, locale } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const styleId = "listflow-landing-hide-crisp";
    let hideStyle = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!hideStyle) {
      hideStyle = document.createElement("style");
      hideStyle.id = styleId;
      hideStyle.textContent = "#crisp-chatbox, #crisp-client, .crisp-client { display: none !important; }";
      document.head.appendChild(hideStyle);
    }

    const crispWindow = window as Window & { $crisp?: unknown[] };
    if (!Array.isArray(crispWindow.$crisp)) {
      crispWindow.$crisp = [];
    }
    crispWindow.$crisp.push(["do", "chat:hide"]);
    crispWindow.$crisp.push(["do", "chat:close"]);

    return () => {
      hideStyle?.remove();
    };
  }, []);

  const copy: LandingCopy =
    locale === "en"
      ? {
          heroPointA: "One-click Etsy automation and hands-free listing flow",
          heroPointB: "AI trend intelligence focused on high-demand products",
          trustTitle: "Growth-focused Etsy sellers rely on Listflow",
          trustItems: ["Etsy Labs", "Pixel Warehouse", "North Atlas", "Studio Nomad", "Flow Commerce"],
          metricCards: [
            { value: "10x", label: "Faster Product Output" },
            { value: "92%", label: "Less Manual Work" },
            { value: "24/7", label: "Auto Listing Momentum" },
            { value: "3x", label: "Higher Catalog Reach" },
          ],
          featureTitle: "Built to grow Etsy revenue, not to add dashboard noise",
          featureSubtitle: "Find trends, generate winning products, and keep listings moving automatically.",
          howTitle: "Your growth loop in 3 steps",
          howSubtitle: "Choose a niche, connect your store, let AI-backed automation do the heavy lifting.",
          howSteps: [
            {
              title: "1. Pick Your Market",
              desc: "Select your category and product direction with clear margin visibility before you launch.",
            },
            {
              title: "2. Activate AI Product Engine",
              desc: "AI trend signals surface high-potential ideas and prepare your store for consistent product flow.",
            },
            {
              title: "3. Scale Listing Output",
              desc: "Your store keeps receiving fresh, market-aligned listings so you can focus on growth and profit.",
            },
          ],
          plansTitle: "Pick the growth speed that fits your goals",
          plansSubtitle: "Move from steady output to aggressive expansion with the plan that matches your pace.",
          plans: [
            {
              name: "Starter",
              cadence: "Automatic Product Upload Every 8 Hours",
              detail: "Ideal starter package for beginners and users who want to test the system.",
              highlights: [
                "Automatic product listing every 8 hours",
                "Start automation from one selected category",
                "SEO-friendly Etsy title + description built on trend keywords",
                "When an order arrives, products are shipped from suppliers in Turkey",
                "Basic order and operations tracking",
                "No manual intervention required, the system runs automatically",
                "One-on-one store setup service is not included",
                "Best fit for users who already have a store and want to launch fast",
              ],
            },
            {
              name: "Pro",
              cadence: "Automatic Product Upload Every 4 Hours + 1:1 Setup",
              detail: "For users who want to grow and build their business professionally.",
              highlights: [
                "Automatic product listing every 4 hours",
                "Choose products from your preferred category",
                "Free one-on-one Etsy store setup support",
                "Trend keyword analysis + SEO-friendly title & description",
                "Sales-focused product positioning",
                "Supplier fulfillment from Turkey for incoming orders",
                "Faster indexing and better visibility advantage",
                "Not a template package, this is strategic growth",
              ],
            },
            {
              name: "Turbo",
              cadence: "Upload Every 2 Hours - Fast Results Package",
              detail: "For users who want aggressive growth and faster outcomes.",
              highlights: [
                "Automatic product listing every 2 hours",
                "Category + niche optimization",
                "Free one-on-one setup and strategic store configuration",
                "Advanced trend analysis and high-demand product selection",
                "Competitor-based market positioning",
                "Priority technical support",
                "Fast supplier fulfillment from Turkey for orders",
                "Fast testing and fast scaling model",
              ],
            },
          ],
          finalTitle: "Turn Etsy into a repeatable growth machine",
          finalSubtitle:
            "Create your account, connect your store, and let AI-assisted automation keep your catalog fresh with products designed for demand.",
          finalPrimaryCta: "Open Pricing",
          finalSecondaryCta: "Start Account",
          cardControlTitle: "Sales Momentum Center",
          cardControlSubtitle: "Live product flow snapshot",
          cardRows: [
            { store: "NordicPrintLab", status: "Trending", eta: "next listing: 01h 12m" },
            { store: "FrameMintCo", status: "Queued", eta: "next listing: 03h 55m" },
            { store: "CraftFlowStudio", status: "Publishing", eta: "next listing: 00h 42m" },
          ],
        }
      : {
          heroPointA: "Tek tıkla Etsy otomasyonu ve zahmetsiz ürün listeleme",
          heroPointB: "Yapay zeka trend analiziyle yüksek satış potansiyeli",
          trustTitle: "Büyüme odaklı Etsy satıcıları Listflow'u seçiyor",
          trustItems: ["Etsy Labs", "Pixel Warehouse", "North Atlas", "Studio Nomad", "Flow Commerce"],
          metricCards: [
            { value: "10x", label: "Daha Hızlı Ürün Çıkışı" },
            { value: "%92", label: "Daha Az Manuel İş" },
            { value: "7/24", label: "Otomatik Listeleme Akışı" },
            { value: "3x", label: "Daha Geniş Katalog Erişimi" },
          ],
          featureTitle: "Panel kalabalığı için değil, Etsy satış büyümesi için tasarlandı",
          featureSubtitle: "Trendleri yakala, kazandıran ürünleri üret, listeleme akışını otomatik yönet.",
          howTitle: "Büyüme döngün 3 adımda çalışır",
          howSubtitle: "Nişini seç, mağazanı bağla, AI destekli otomasyon satış tarafını hızlandırsın.",
          howSteps: [
            {
              title: "1. Pazarı Seç",
              desc: "Kategori ve ürün yönünü belirle, lansman öncesi marj görünürlüğüyle net karar ver.",
            },
            {
              title: "2. AI Ürün Motorunu Başlat",
              desc: "Yapay zeka trend sinyalleri yüksek potansiyelli fikirleri öne çıkarır ve düzenli üretim akışı hazırlar.",
            },
            {
              title: "3. Listeleme Hızını Ölçekle",
              desc: "Mağazan düzenli olarak yeni, talep odaklı ürünlerle güncellenir; sen satış ve kâra odaklanırsın.",
            },
          ],
          plansTitle: "Hedefine uygun büyüme hızını seç",
          plansSubtitle: "Dengeli başlangıçtan agresif ölçeklemeye kadar üretim hızını planın belirlesin.",
          plans: [
            {
              name: "Starter",
              cadence: "8 Saatte Bir Otomatik Ürün Yükleme",
              detail: "Yeni başlayanlar ve sistemi test etmek isteyenler için ideal başlangıç paketi.",
              highlights: [
                "8 saatte bir otomatik ürün listeleme",
                "Seçtiğin 1 kategori üzerinden otomasyon başlatma",
                "Etsy’de aranan trend anahtar kelimelerle SEO uyumlu başlık + açıklama",
                "Sipariş geldiğinde ürünler Türkiye’deki tedarikçiden gönderilir",
                "Temel sipariş ve operasyon takibi",
                "Manuel müdahale gerektirmez, sistem otomatik çalışır",
                "Birebir mağaza kurulum hizmeti dahil değildir.",
                "Kendi mağazası olan ve hızlı başlamak isteyenler için uygundur.",
              ],
            },
            {
              name: "Pro",
              cadence: "4 Saatte Bir Otomatik Ürün Yükleme + Birebir Kurulum",
              detail: "Büyümek ve işi profesyonel kurmak isteyenler için.",
              highlights: [
                "4 saatte bir otomatik ürün listeleme",
                "İstediğin kategoriden ürün seçebilme",
                "Birebir Etsy mağaza açılış ve kurulum desteği (ücretsiz)",
                "Trend kelime analizi + SEO uyumlu başlık & açıklama",
                "Satış odaklı ürün konumlandırma",
                "Siparişlerde Türkiye’den tedarikçi gönderimi",
                "Daha hızlı indeks alma ve görünürlük avantajı",
                "Hazır sistem değil, stratejik büyüme paketi.",
              ],
            },
            {
              name: "Turbo",
              cadence: "2 Saatte Bir Yükleme - Hızlı Sonuç Paketi",
              detail: "Agresif büyüme ve hızlı sonuç almak isteyenler için.",
              highlights: [
                "2 saatte bir otomatik ürün listeleme",
                "Kategori + niş optimizasyonu",
                "Birebir mağaza kurulum ve stratejik yapılandırma (ücretsiz)",
                "Gelişmiş trend analizi ve yüksek talep ürün seçimi",
                "Rakip analizine göre konumlandırma",
                "Öncelikli teknik destek",
                "Siparişlerde Türkiye’den hızlı tedarikçi gönderimi",
                "Hızlı test - hızlı ölçekleme mantığı",
              ],
            },
          ],
          finalTitle: "Etsy mağazanı sürdürülebilir satış motoruna dönüştür",
          finalSubtitle:
            "Hesabını aç, mağazanı bağla ve talep gören ürünlerle sürekli güncellenen katalog sayesinde düzenli gelir üretmeye başla.",
          finalPrimaryCta: "Fiyatlandırmayı Aç",
          finalSecondaryCta: "Hesap Aç",
          cardControlTitle: "Satış Hızı Kontrol Merkezi",
          cardControlSubtitle: "Canlı ürün akışı görünümü",
          cardRows: [
            { store: "NordicPrintLab", status: "Trendde", eta: "sıradaki ürün: 01s 12dk" },
            { store: "FrameMintCo", status: "Kuyrukta", eta: "sıradaki ürün: 03s 55dk" },
            { store: "CraftFlowStudio", status: "Listeleniyor", eta: "sıradaki ürün: 00s 42dk" },
          ],
        };

  const landingCoreFeatures = messages.landing.features.map((feature, index) => ({
    icon: coreFeatureIcons[index] ?? Layers,
    title: feature.title,
    desc: feature.desc,
    badge: locale === "en" ? "Core" : "Temel",
  }));

  const extraFeatures: FeatureCard[] =
    locale === "en"
      ? [
          {
            icon: extraFeatureIcons[0] ?? ShieldCheck,
            title: "AI Trend Radar",
            desc: "Demand-focused trend scanning highlights product ideas with strong buyer intent on Etsy.",
            badge: "AI",
          },
          {
            icon: extraFeatureIcons[1] ?? Workflow,
            title: "One-Click Listing Flow",
            desc: "From product idea to ready-to-sell listing, your store keeps moving without manual busywork.",
            badge: "Growth",
          },
        ]
      : [
          {
            icon: extraFeatureIcons[0] ?? ShieldCheck,
            title: "AI Trend Radarı",
            desc: "Etsy talep sinyallerini analiz ederek satın alma potansiyeli yüksek ürün fikirlerini öne çıkarır.",
            badge: "AI",
          },
          {
            icon: extraFeatureIcons[1] ?? Workflow,
            title: "Tek Tık Listeleme Akışı",
            desc: "Ürün fikrinden satışa hazır listelemeye kadar mağazan manuel yükü azaltarak sürekli çalışır.",
            badge: "Büyüme",
          },
        ];

  const allFeatures: FeatureCard[] = [...landingCoreFeatures, ...extraFeatures];

  return (
    <div className="relative overflow-hidden bg-[#07080d] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-[-180px] h-[420px] w-[420px] rounded-full bg-indigo-500/25 blur-[140px]" />
        <div className="absolute right-[-180px] top-16 h-[360px] w-[360px] rounded-full bg-cyan-500/15 blur-[130px]" />
        <div className="absolute bottom-[-220px] left-1/2 h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-[160px]" />
      </div>

      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#07080d]/72 px-6 py-5 backdrop-blur-2xl md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="flex h-11 w-11 group-hover:rotate-12 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-indigo-500 transition-all items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_25px_rgba(79,70,229,0.35)]">
              <Rocket className="h-5 w-5 text-white" />
            </div>
            <p className="text-xl font-black tracking-tight">
              listflow<span className="text-indigo-400">.pro</span>
            </p>
          </div>

          <div className="hidden items-center gap-10 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 lg:flex">
            <a href="#landing-features" className="transition-colors hover:text-indigo-300">
              {t("landing.navFeatures")}
            </a>
            <a href="#landing-catalog" className="transition-colors hover:text-indigo-300">
              {t("landing.navCatalog")}
            </a>
            <Link href="/pricing" className="transition-colors hover:text-indigo-300">
              {t("landing.navPricing")}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white lg:hidden cursor-pointer"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label="Menüyü aç"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button
              onClick={() => router.push("/login")}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-all hover:border-indigo-400/35 hover:bg-indigo-500/10 md:px-6 md:py-3 md:text-[11px]"
            >
              {t("landing.login")}
            </button>
          </div>
        </div>
        {mobileNavOpen ? (
          <div className="mx-auto mt-4 max-w-7xl rounded-2xl border border-white/10 bg-[#0d1018] p-4 lg:hidden">
            <div className="flex flex-col gap-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-300">
              <a href="#landing-features" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navFeatures")}
              </a>
              <a href="#landing-catalog" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navCatalog")}
              </a>
              <Link href="/pricing" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navPricing")}
              </Link>
            </div>
          </div>
        ) : null}
      </nav>

      <main className="relative z-10 px-6 pb-24 pt-32 md:px-8 md:pt-36">
        <section className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
              <Sparkles className="h-4 w-4" />
              {t("landing.badge")}
            </div>

            <h1 className="text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl lg:text-7xl">
              {t("landing.titleLine1")}
              <br />
              <span className="text-indigo-400">{t("landing.titleAccent")}</span> {t("landing.titleLine2")}
            </h1>

            <p className="mt-7 max-w-2xl text-base font-semibold leading-relaxed text-slate-300 sm:text-lg">
              {t("landing.subtitle")}
            </p>

            <div className="mt-8 flex flex-col gap-3 text-sm font-semibold text-slate-300 sm:flex-row sm:items-center sm:gap-7">
              <div className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>{copy.heroPointA}</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-indigo-300" />
                <span>{copy.heroPointB}</span>
              </div>
            </div>

            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <button
                onClick={() => router.push("/login")}
                className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/50 bg-indigo-600 px-8 py-4 text-xs font-black uppercase tracking-[0.2em] text-white shadow-[0_0_35px_rgba(79,70,229,0.35)] transition-all hover:bg-indigo-500"
              >
                {t("landing.startNow")}
                <ChevronRight className="h-4 w-4" />
              </button>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:border-indigo-400/40 hover:bg-white/10"
              >
                {t("landing.discover")}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="relative rounded-[34px] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.cardControlTitle}</p>
                <p className="mt-1 text-sm font-semibold text-slate-400">{copy.cardControlSubtitle}</p>
              </div>
              <div className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                Live
              </div>
            </div>

            <div className="space-y-3">
              {copy.cardRows.map((row) => (
                <div key={row.store} className="rounded-2xl border border-white/10 bg-[#0d1220]/70 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-white">{row.store}</p>
                    <span className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-300">
                      {row.status}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-400">{row.eta}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-7 items-end gap-2">
              {[38, 52, 44, 60, 54, 70, 64].map((height, index) => (
                <motion.div
                  key={`${height}-${index}`}
                  initial={{ scaleY: 0.2, opacity: 0.25 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: 0.2 + index * 0.05, duration: 0.35 }}
                  className="origin-bottom rounded-md bg-gradient-to-t from-indigo-500/25 to-cyan-300/70"
                  style={{ height }}
                />
              ))}
            </div>
          </motion.div>
        </section>

        <section className="mx-auto mt-16 max-w-7xl">
          <p className="mb-5 text-center text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">{copy.trustTitle}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {copy.trustItems.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section id="landing-catalog" className="mx-auto mt-12 grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {copy.metricCards.map((metric) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
            >
              <p className="text-3xl font-black tracking-tight text-white">{metric.value}</p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{metric.label}</p>
            </motion.div>
          ))}
        </section>

        <section id="landing-features" className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.featureTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.featureSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {allFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <motion.article
                  key={feature.title}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  className="group rounded-[28px] border border-white/10 bg-white/5 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/35 hover:bg-indigo-500/10"
                >
                  <div className="mb-4 inline-flex rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3">
                    <Icon className="h-5 w-5 text-indigo-300" />
                  </div>
                  <p className="mb-2 inline-flex rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                    {feature.badge}
                  </p>
                  <h3 className="text-xl font-black tracking-tight text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-400">{feature.desc}</p>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.howTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.howSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {copy.howSteps.map((step) => (
              <motion.article
                key={step.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                className="rounded-[28px] border border-white/10 bg-[#0f1422]/80 p-6"
              >
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/35 bg-indigo-500/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                  <Bot className="h-3.5 w-3.5" />
                  {step.title}
                </div>
                <p className="text-sm font-medium leading-relaxed text-slate-300">{step.desc}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.plansTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.plansSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {copy.plans.map((plan, index) => (
              <motion.article
                key={plan.name}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                className={`rounded-[30px] border p-7 ${
                  index === 1
                    ? "border-indigo-400/45 bg-indigo-500/12 shadow-[0_0_35px_rgba(79,70,229,0.25)]"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <div className="mb-3 inline-flex rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  {plan.name}
                </div>
                <p className="text-2xl font-black tracking-tight text-white">{plan.cadence}</p>
                <p className="mt-1 text-sm font-semibold text-slate-400">{plan.detail}</p>
                <div className="mt-5 space-y-2">
                  {plan.highlights.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <Zap className="h-4 w-4 text-indigo-300" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            className="rounded-[36px] border border-indigo-400/35 bg-gradient-to-r from-indigo-600/35 via-indigo-500/20 to-cyan-500/20 p-8 md:p-11"
          >
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">listflow.pro</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.finalTitle}</h2>
              <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-200 md:text-base">{copy.finalSubtitle}</p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white px-7 py-4 text-xs font-black uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-100"
              >
                {copy.finalPrimaryCta}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <button
                onClick={() => router.push("/login")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-7 py-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-white/15"
              >
                {copy.finalSecondaryCta}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </section>
      </main>
    </div>
  );
};

export default LandingPage;
