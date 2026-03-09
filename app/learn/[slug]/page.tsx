import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LearnDocsView from "@/components/Learn/LearnDocsView";
import JsonLd from "@/components/seo/JsonLd";
import { detectLocale } from "@/lib/i18n/detect-locale";
import { getLearnGuides } from "@/lib/learn/repository";
import { SITE_NAME, SITE_URL, buildMetadata } from "@/lib/seo";

type LearnSlugPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateMetadata({ params }: LearnSlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  const normalizedSlug = decodeURIComponent(slug || "").trim().toLowerCase();
  const guides = await getLearnGuides();
  const guide = guides.find((item) => item.slug === normalizedSlug) ?? null;

  if (!guide) {
    return buildMetadata({
      title: "Learn",
      path: `/learn/${normalizedSlug}`,
      noIndex: true,
    });
  }

  return buildMetadata({
    title: guide.title.en,
    description: guide.summary.en,
    path: `/learn/${guide.slug}`,
    type: "article",
    keywords: guide.tags.flatMap((tag) => [tag.en, tag.tr]),
  });
}

export default async function LearnSlugPage({ params }: LearnSlugPageProps) {
  const { slug } = await params;
  const normalizedSlug = decodeURIComponent(slug || "").trim().toLowerCase();
  const guides = await getLearnGuides();
  const guide = guides.find((item) => item.slug === normalizedSlug) ?? null;

  if (!guide) {
    notFound();
  }

  const locale = detectLocale(await cookies(), await headers());
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Learn",
                item: `${SITE_URL}/learn`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: guide.title.en,
                item: `${SITE_URL}/learn/${guide.slug}`,
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: guide.title.en,
            description: guide.summary.en,
            url: `${SITE_URL}/learn/${guide.slug}`,
            dateModified: guide.updatedAt,
            author: {
              "@type": "Organization",
              name: SITE_NAME,
            },
            publisher: {
              "@type": "Organization",
              name: SITE_NAME,
            },
          },
        ]}
      />
      <LearnDocsView locale={locale} activeGuide={guide} guides={guides} />
    </>
  );
}
