import { supabaseAdmin } from "@/lib/supabase/admin";
import { learnGuides as staticLearnGuides, type LearnGuide, type LearnGuideSection } from "@/lib/learn/guides";

type LearnGuideRow = {
  slug: string | null;
  category_tr: string | null;
  category_en: string | null;
  title_tr: string | null;
  title_en: string | null;
  summary_tr: string | null;
  summary_en: string | null;
  tags_tr: string[] | null;
  tags_en: string[] | null;
  youtube_id: string | null;
  duration_minutes: number | null;
  sections_tr: unknown;
  sections_en: unknown;
  updated_at: string | null;
  sort_order: number | null;
};

type FlatSection = {
  heading: string;
  body: string;
  bullets: string[];
};

const LEARN_GUIDE_SELECT =
  "slug,category_tr,category_en,title_tr,title_en,summary_tr,summary_en,tags_tr,tags_en,youtube_id,duration_minutes,sections_tr,sections_en,updated_at,sort_order";

const isMissingLearnGuidesTableError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

const toFlatSections = (value: unknown): FlatSection[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sections: FlatSection[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const heading = typeof record.heading === "string" ? record.heading.trim() : "";
    const body = typeof record.body === "string" ? record.body.trim() : "";
    const bullets = toStringArray(record.bullets);

    if (!heading && !body && bullets.length === 0) {
      continue;
    }

    sections.push({ heading, body, bullets });
  }

  return sections;
};

const toLocalizedSections = (sectionsTrValue: unknown, sectionsEnValue: unknown): LearnGuideSection[] => {
  const trSections = toFlatSections(sectionsTrValue);
  const enSections = toFlatSections(sectionsEnValue);

  const maxLength = Math.max(trSections.length, enSections.length);
  const localizedSections: LearnGuideSection[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const trSection = trSections[index] ?? { heading: "", body: "", bullets: [] };
    const enSection = enSections[index] ?? { heading: "", body: "", bullets: [] };

    const bulletCount = Math.max(trSection.bullets.length, enSection.bullets.length);
    const bullets = Array.from({ length: bulletCount }).map((_, bulletIndex) => {
      const trBullet = trSection.bullets[bulletIndex] ?? enSection.bullets[bulletIndex] ?? "";
      const enBullet = enSection.bullets[bulletIndex] ?? trSection.bullets[bulletIndex] ?? "";
      return { tr: trBullet, en: enBullet };
    });

    const headingTr = trSection.heading || enSection.heading;
    const headingEn = enSection.heading || trSection.heading;
    const bodyTr = trSection.body || enSection.body;
    const bodyEn = enSection.body || trSection.body;

    if (!headingTr && !headingEn && !bodyTr && !bodyEn && bullets.length === 0) {
      continue;
    }

    localizedSections.push({
      heading: {
        tr: headingTr,
        en: headingEn,
      },
      body: {
        tr: bodyTr,
        en: bodyEn,
      },
      bullets,
    });
  }

  return localizedSections;
};

const toLocalizedTags = (tagsTrValue: unknown, tagsEnValue: unknown) => {
  const tagsTr = toStringArray(tagsTrValue);
  const tagsEn = toStringArray(tagsEnValue);

  const maxLength = Math.max(tagsTr.length, tagsEn.length);
  return Array.from({ length: maxLength })
    .map((_, index) => {
      const tr = tagsTr[index] ?? tagsEn[index] ?? "";
      const en = tagsEn[index] ?? tagsTr[index] ?? "";

      if (!tr && !en) {
        return null;
      }

      return { tr, en };
    })
    .filter((tag): tag is { tr: string; en: string } => Boolean(tag));
};

const toLearnGuide = (row: LearnGuideRow): LearnGuide | null => {
  const slug = (row.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return null;
  }

  const categoryTr = (row.category_tr ?? "").trim();
  const categoryEn = (row.category_en ?? "").trim();
  const titleTr = (row.title_tr ?? "").trim();
  const titleEn = (row.title_en ?? "").trim();

  if (!titleTr && !titleEn) {
    return null;
  }

  const summaryTr = (row.summary_tr ?? "").trim();
  const summaryEn = (row.summary_en ?? "").trim();
  const youtubeId = (row.youtube_id ?? "").trim();
  const durationMinutes = Number.isFinite(Number(row.duration_minutes)) ? Number(row.duration_minutes) : 0;
  const updatedAt = row.updated_at ?? new Date().toISOString();

  return {
    slug,
    category: {
      tr: categoryTr || categoryEn || "Kategori",
      en: categoryEn || categoryTr || "Category",
    },
    title: {
      tr: titleTr || titleEn,
      en: titleEn || titleTr,
    },
    summary: {
      tr: summaryTr || summaryEn,
      en: summaryEn || summaryTr,
    },
    tags: toLocalizedTags(row.tags_tr, row.tags_en),
    youtubeId,
    updatedAt,
    durationMinutes,
    sections: toLocalizedSections(row.sections_tr, row.sections_en),
  };
};

const fallbackStaticGuides = () => [...staticLearnGuides];

const mapStaticGuideToSeedRow = (index: number, guide: LearnGuide) => ({
  slug: guide.slug,
  category_tr: guide.category.tr,
  category_en: guide.category.en,
  title_tr: guide.title.tr,
  title_en: guide.title.en,
  summary_tr: guide.summary.tr,
  summary_en: guide.summary.en,
  tags_tr: guide.tags.map((tag) => tag.tr),
  tags_en: guide.tags.map((tag) => tag.en),
  youtube_id: guide.youtubeId,
  duration_minutes: guide.durationMinutes,
  sections_tr: guide.sections.map((section) => ({
    heading: section.heading.tr,
    body: section.body.tr,
    bullets: section.bullets.map((bullet) => bullet.tr),
  })),
  sections_en: guide.sections.map((section) => ({
    heading: section.heading.en,
    body: section.body.en,
    bullets: section.bullets.map((bullet) => bullet.en),
  })),
  sort_order: index,
  is_published: true,
});

const fetchPublishedGuideRows = async () => {
  return await supabaseAdmin
    .from("learn_guides")
    .select(LEARN_GUIDE_SELECT)
    .eq("is_published", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(200);
};

export const upsertStaticLearnGuides = async () => {
  const seedRows = staticLearnGuides.map((guide, index) => mapStaticGuideToSeedRow(index, guide));
  const { error } = await supabaseAdmin.from("learn_guides").upsert(seedRows, { onConflict: "slug" });
  return { ok: !error, error };
};

export const getLearnGuides = async (): Promise<LearnGuide[]> => {
  let { data, error } = await fetchPublishedGuideRows();

  if (!error && (!data || data.length === 0)) {
    const seedResult = await upsertStaticLearnGuides();
    if (seedResult.ok) {
      const refetch = await fetchPublishedGuideRows();
      data = refetch.data;
      error = refetch.error;
    }
  }

  if (error) {
    if (!isMissingLearnGuidesTableError(error)) {
      console.error("[learn] failed to load learn_guides:", error.message);
    }
    return fallbackStaticGuides();
  }

  const mapped = (data ?? [])
    .map((row) => toLearnGuide(row as LearnGuideRow))
    .filter((guide): guide is LearnGuide => Boolean(guide));

  if (!mapped.length) {
    return fallbackStaticGuides();
  }

  return mapped;
};

export const getLearnGuideBySlug = async (slug: string): Promise<LearnGuide | null> => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const guides = await getLearnGuides();
  return guides.find((guide) => guide.slug === normalizedSlug) ?? null;
};
