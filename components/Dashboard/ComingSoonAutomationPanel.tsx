"use client";

import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n/provider";
import { DashboardSection } from "@/types";
import {
  Clock3,
  Globe2,
  Package,
  ShieldCheck,
  Sparkles,
  Workflow,
  CheckCircle2,
  Rocket,
  Lightbulb,
  Timer,
} from "lucide-react";

type ComingSoonPanelProps = {
  section: DashboardSection;
};

type PanelContent = {
  eyebrow: string;
  title: string;
  subtitle: string;
  eta: string;
  highlights: string[];
  flow: string[];
  noteTitle: string;
  noteText: string;
};

const ComingSoonAutomationPanel: React.FC<ComingSoonPanelProps> = ({ section }) => {
  const { locale } = useI18n();

  const isEn = locale === "en";

  const contentMap: Partial<Record<DashboardSection, PanelContent>> = {
    [DashboardSection.PINTEREST_AUTOMATION]: isEn
      ? {
          eyebrow: "Pinterest Automation",
          title: "Traffic-first Pinterest growth pipeline is on the roadmap",
          subtitle:
            "Automate pin content generation, keyword mapping, and board publishing to drive qualified traffic into your store.",
          eta: "Target launch: Q2 2026",
          highlights: [
            "AI-assisted pin title + description generation",
            "Keyword cluster suggestions for search visibility",
            "Board strategy templates by niche",
            "Scheduled pin publishing workflow",
          ],
          flow: ["Niche signal analysis", "Pin set generation", "Queue and publish", "Performance feedback loop"],
          noteTitle: "What this means for you",
          noteText:
            "When released, Pinterest automation will be integrated with your existing store logic and category strategy.",
        }
      : {
          eyebrow: "Pinterest Otomasyon",
          title: "Trafik odaklı Pinterest büyüme hattı sıradaki roadmap adımı",
          subtitle:
            "Pin içerik üretimi, anahtar kelime eşlemesi ve pano yayın akışını otomatikleştirerek mağazana nitelikli trafik çekeceksin.",
          eta: "Hedef lansman: 2026 Q2",
          highlights: [
            "AI destekli pin başlık + açıklama üretimi",
            "Arama görünürlüğü için anahtar kelime kümeleri",
            "Niş bazlı pano strateji şablonları",
            "Zamanlanmış pin yayınlama akışı",
          ],
          flow: ["Niş sinyal analizi", "Pin seti üretimi", "Kuyruğa al ve yayınla", "Performans geri besleme döngüsü"],
          noteTitle: "Senin için anlamı",
          noteText:
            "Yayınlandığında Pinterest otomasyonu mevcut mağaza mantığın ve kategori stratejinle entegre çalışacak.",
        },
    [DashboardSection.META_AUTOMATION]: isEn
      ? {
          eyebrow: "Meta Automation",
          title: "Meta catalog + campaign sync automation is being prepared",
          subtitle:
            "Create a repeatable flow between product feed updates and campaign-ready creative assets for Meta channels.",
          eta: "Target launch: Q2 2026",
          highlights: [
            "Catalog-ready product data formatter",
            "Campaign copy variants by audience angle",
            "Creative package mapping for reels/feed",
            "Operational sync status tracking",
          ],
          flow: ["Catalog normalization", "Creative pack generation", "Ad set alignment", "Iteration and optimization"],
          noteTitle: "What this means for you",
          noteText:
            "Meta automation will be designed to reduce manual ad ops while preserving your product-level control.",
        }
      : {
          eyebrow: "Meta Otomasyon",
          title: "Meta katalog + kampanya senkron otomasyonu hazırlanıyor",
          subtitle:
            "Ürün feed güncellemeleri ile kampanyaya hazır kreatif varlıkları Meta kanallarında tekrar edilebilir bir akışta birleştireceğiz.",
          eta: "Hedef lansman: 2026 Q2",
          highlights: [
            "Katalog uyumlu ürün veri dönüştürücüsü",
            "Hedef kitle açısına göre kampanya metin varyantları",
            "Reels/feed için kreatif paket eşlemesi",
            "Operasyonel senkron durum takibi",
          ],
          flow: ["Katalog normalizasyonu", "Kreatif paket üretimi", "Reklam seti hizalama", "İterasyon ve optimizasyon"],
          noteTitle: "Senin için anlamı",
          noteText:
            "Meta otomasyonu manuel reklam operasyonunu azaltırken ürün bazlı kontrolünü koruyacak şekilde tasarlanıyor.",
        },
    [DashboardSection.EBAY_AUTOMATION]: isEn
      ? {
          eyebrow: "eBay Automation",
          title: "eBay multi-listing engine is planned as the next channel expansion",
          subtitle:
            "Duplicate your winning product structure into eBay-ready listings with channel-specific formatting logic.",
          eta: "Target launch: Q3 2026",
          highlights: [
            "Channel-aware listing field transformer",
            "Category and attribute mapping helpers",
            "Bulk listing queue with validation layer",
            "Status visibility for listing operations",
          ],
          flow: ["Source product selection", "Field transformation", "Bulk queue execution", "Channel feedback handling"],
          noteTitle: "What this means for you",
          noteText:
            "You will be able to expand to eBay without rebuilding your entire listing workflow from scratch.",
        }
      : {
          eyebrow: "Ebay Otomasyon",
          title: "eBay çoklu listeleme motoru bir sonraki kanal genişleme adımı",
          subtitle:
            "Kazanan ürün yapını kanal bazlı formatlama mantığıyla eBay uyumlu listelemelere dönüştürebileceksin.",
          eta: "Hedef lansman: 2026 Q3",
          highlights: [
            "Kanal farkındalıklı listing alan dönüştürücüsü",
            "Kategori ve attribute eşleme yardımcıları",
            "Doğrulama katmanlı toplu listeleme kuyruğu",
            "Listeleme operasyonları için durum görünürlüğü",
          ],
          flow: ["Kaynak ürün seçimi", "Alan dönüşümü", "Toplu kuyruk yürütme", "Kanal geri bildirim işleme"],
          noteTitle: "Senin için anlamı",
          noteText:
            "eBay’e geçerken tüm listeleme akışını sıfırdan kurmadan kanal genişletebileceksin.",
        },
    [DashboardSection.AMAZON_AUTOMATION]: isEn
      ? {
          eyebrow: "Amazon Automation",
          title: "Amazon listing and compliance workflow is in active planning",
          subtitle:
            "Prepare product data, listing copy, and operational checks for Amazon-specific listing standards.",
          eta: "Target launch: Q3 2026",
          highlights: [
            "Amazon-ready listing schema preparation",
            "Compliance-first copy and attribute checks",
            "Operational checklist before publish",
            "Channel rollout monitoring dashboard",
          ],
          flow: ["Data readiness", "Compliance validation", "Publish preparation", "Ongoing monitoring"],
          noteTitle: "What this means for you",
          noteText:
            "Amazon automation will prioritize operational safety while helping you scale listing volume faster.",
        }
      : {
          eyebrow: "Amazon Otomasyon",
          title: "Amazon listeleme ve uyumluluk akışı aktif planlama aşamasında",
          subtitle:
            "Amazon’a özel listeleme standartları için ürün verisi, içerik ve operasyon kontrol adımları hazır hale getirilecek.",
          eta: "Hedef lansman: 2026 Q3",
          highlights: [
            "Amazon uyumlu listing şema hazırlığı",
            "Uyumluluk öncelikli metin ve alan kontrolleri",
            "Yayın öncesi operasyonel kontrol listesi",
            "Kanal rollout izleme paneli",
          ],
          flow: ["Veri hazırlığı", "Uyumluluk doğrulama", "Yayın hazırlığı", "Süreç izleme"],
          noteTitle: "Senin için anlamı",
          noteText:
            "Amazon otomasyonu operasyon güvenliğini korurken listeleme hacmini daha hızlı ölçeklemene odaklanacak.",
        },
    [DashboardSection.CATEGORIES]: {
      eyebrow: "",
      title: "",
      subtitle: "",
      eta: "",
      highlights: [],
      flow: [],
      noteTitle: "",
      noteText: "",
    },
    [DashboardSection.ETSY_AUTOMATION]: {
      eyebrow: "",
      title: "",
      subtitle: "",
      eta: "",
      highlights: [],
      flow: [],
      noteTitle: "",
      noteText: "",
    },
    [DashboardSection.ORDERS]: {
      eyebrow: "",
      title: "",
      subtitle: "",
      eta: "",
      highlights: [],
      flow: [],
      noteTitle: "",
      noteText: "",
    },
    [DashboardSection.SETTINGS]: {
      eyebrow: "",
      title: "",
      subtitle: "",
      eta: "",
      highlights: [],
      flow: [],
      noteTitle: "",
      noteText: "",
    },
  };

  const content = contentMap[section] ?? {
    eyebrow: "",
    title: "",
    subtitle: "",
    eta: "",
    highlights: [],
    flow: [],
    noteTitle: "",
    noteText: "",
  };

  const iconBySection = {
    [DashboardSection.PINTEREST_AUTOMATION]: Sparkles,
    [DashboardSection.META_AUTOMATION]: Globe2,
    [DashboardSection.EBAY_AUTOMATION]: Workflow,
    [DashboardSection.AMAZON_AUTOMATION]: ShieldCheck,
  } as const;

  const SectionIcon = iconBySection[section as keyof typeof iconBySection] ?? Rocket;

  return (
    <div className="h-full w-full overflow-y-auto p-5">
      <div className="mx-auto max-w-6xl space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0f1422]/90 p-8 shadow-[0_24px_70px_rgba(5,10,28,0.5)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-16 -top-20 h-52 w-52 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="absolute -right-16 bottom-[-40px] h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1">
                <SectionIcon className="h-3.5 w-3.5 text-indigo-300" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                  {content.eyebrow}
                </span>
              </div>

              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">
                {content.title}
              </h1>
              <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-300 sm:text-base">
                {content.subtitle}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-amber-300" />
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
                  {isEn ? "Coming Soon" : "Yakında"}
                </p>
              </div>
              <p className="mt-2 text-sm font-bold text-white">{content.eta}</p>
            </div>
          </div>
        </motion.section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-[28px] border border-white/10 bg-white/5 p-6"
          >
            <div className="mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-indigo-300" />
              <h2 className="text-sm font-black uppercase tracking-[0.16em] text-indigo-300">
                {isEn ? "Planned Features" : "Planlanan Özellikler"}
              </h2>
            </div>
            <div className="space-y-3">
              {content.highlights.map((feature) => (
                <div key={feature} className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#121a2c]/70 px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <p className="text-sm font-semibold text-slate-200">{feature}</p>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-[28px] border border-white/10 bg-white/5 p-6"
          >
            <div className="mb-4 flex items-center gap-2">
              <Timer className="h-4 w-4 text-cyan-300" />
              <h2 className="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">
                {isEn ? "Automation Flow" : "Otomasyon Akışı"}
              </h2>
            </div>
            <div className="space-y-3">
              {content.flow.map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#121a2c]/70 px-3 py-2.5">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-[10px] font-black text-cyan-300">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold text-slate-200">{step}</p>
                </div>
              ))}
            </div>
          </motion.section>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-[28px] border border-indigo-400/20 bg-indigo-500/10 p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h3 className="text-sm font-black uppercase tracking-[0.16em] text-indigo-300">
                {content.noteTitle}
              </h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-200">{content.noteText}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-600/20 px-3 py-1.5">
              <Package className="h-4 w-4 text-indigo-200" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-100">
                {isEn ? "Roadmap Active" : "Roadmap Aktif"}
              </span>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
};

export default ComingSoonAutomationPanel;
