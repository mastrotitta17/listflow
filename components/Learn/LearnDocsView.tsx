import Link from "next/link";
import { BookOpen, CalendarDays, Clock3, ExternalLink, Rocket } from "lucide-react";
import Footer from "@/components/Footer";
import type { SupportedLocale } from "@/lib/i18n/config";
import { pickLocalizedTag, pickLocalizedText, type LearnGuide } from "@/lib/learn/guides";

type LearnDocsViewProps = {
  locale: SupportedLocale;
  activeGuide: LearnGuide;
  guides: LearnGuide[];
};

const formatDate = (isoDate: string, locale: SupportedLocale) => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString(locale === "en" ? "en-US" : "tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export default function LearnDocsView({ locale, activeGuide, guides }: LearnDocsViewProps) {
  const isEn = locale === "en";
  const groupedByCategory = guides.reduce<Record<string, LearnGuide[]>>((acc, guide) => {
    const key = pickLocalizedText(locale, guide.category);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(guide);
    return acc;
  }, {});

  const otherGuides = guides.filter((guide) => guide.slug !== activeGuide.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-[#07080d] text-white">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-[#0f1320]/90 px-5 py-4 backdrop-blur">
          <Link href="/" className="group inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_25px_rgba(79,70,229,0.35)] transition-all group-hover:rotate-12 group-hover:scale-110">
              <Rocket className="h-5 w-5 text-white" />
            </span>
            <span className="text-lg font-black tracking-tight">
              listflow<span className="text-indigo-400">.pro</span>
            </span>
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {isEn ? "View Pricing" : "Fiyatlandırma"}
          </Link>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/10 bg-[#0f1320]/75 p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.22em] text-indigo-300">
              <BookOpen className="h-3.5 w-3.5" />
              {isEn ? "Learn / Docs" : "Nasıl Çalışır / Docs"}
            </div>

            <div className="space-y-5">
              {Object.entries(groupedByCategory).map(([category, guides]) => (
                <div key={category} className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{category}</p>
                  <div className="space-y-1.5">
                    {guides.map((guide) => {
                      const isActive = guide.slug === activeGuide.slug;
                      return (
                        <Link
                          key={guide.slug}
                          href={`/learn/${guide.slug}`}
                          className={`block rounded-xl border px-3 py-2.5 transition-colors ${
                            isActive
                              ? "border-indigo-400/40 bg-indigo-500/15"
                              : "border-white/10 bg-white/5 hover:border-indigo-500/30 hover:bg-[#151b2d]"
                          }`}
                        >
                          <p className={`text-sm font-bold ${isActive ? "text-white" : "text-slate-200"}`}>
                            {pickLocalizedText(locale, guide.title)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{pickLocalizedText(locale, guide.summary)}</p>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <main className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#161b2d] via-[#10192a] to-[#0b1120] p-6 sm:p-8">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {activeGuide.tags.map((tag) => (
                  <span key={tag.en} className="rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-teal-300">
                    {pickLocalizedTag(locale, tag)}
                  </span>
                ))}
              </div>

              <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                {pickLocalizedText(locale, activeGuide.title)}
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-relaxed text-slate-300 sm:text-base">
                {pickLocalizedText(locale, activeGuide.summary)}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-indigo-300" />
                  {formatDate(activeGuide.updatedAt, locale)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-indigo-300" />
                  {activeGuide.durationMinutes} {isEn ? "min read" : "dk okuma"}
                </span>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0e1321]">
              <div className="aspect-video w-full">
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${activeGuide.youtubeId}`}
                  title={pickLocalizedText(locale, activeGuide.title)}
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </section>

            <section className="space-y-4">
              {activeGuide.sections.map((section) => (
                <article key={section.heading.en} className="rounded-2xl border border-white/10 bg-[#0f1424] p-5 sm:p-6">
                  <h2 className="text-lg font-black text-white sm:text-xl">{pickLocalizedText(locale, section.heading)}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300 sm:text-base">
                    {pickLocalizedText(locale, section.body)}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {section.bullets.map((bullet) => (
                      <li key={bullet.en} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        <span>{pickLocalizedText(locale, bullet)}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>

            {otherGuides.length ? (
              <section className="rounded-2xl border border-white/10 bg-[#0f1320]/70 p-5">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-300">
                  {isEn ? "More Guides" : "Diğer Rehberler"}
                </h3>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {otherGuides.map((guide) => (
                    <Link key={guide.slug} href={`/learn/${guide.slug}`} className="rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-indigo-500/40 hover:bg-[#151c30]">
                      <p className="text-sm font-black text-white">{pickLocalizedText(locale, guide.title)}</p>
                      <p className="mt-2 line-clamp-2 text-xs text-slate-400">{pickLocalizedText(locale, guide.summary)}</p>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
