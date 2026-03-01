import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import LearnDocsView from "@/components/Learn/LearnDocsView";
import { detectLocale } from "@/lib/i18n/detect-locale";
import { getLearnGuides } from "@/lib/learn/repository";

type LearnSlugPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function LearnSlugPage({ params }: LearnSlugPageProps) {
  const { slug } = await params;
  const normalizedSlug = decodeURIComponent(slug || "").trim().toLowerCase();
  const guides = await getLearnGuides();
  const guide = guides.find((item) => item.slug === normalizedSlug) ?? null;

  if (!guide) {
    notFound();
  }

  const locale = detectLocale(await cookies(), await headers());
  return <LearnDocsView locale={locale} activeGuide={guide} guides={guides} />;
}
