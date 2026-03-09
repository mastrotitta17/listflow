import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import LearnDocsView from "@/components/Learn/LearnDocsView";
import JsonLd from "@/components/seo/JsonLd";
import { detectLocale } from "@/lib/i18n/detect-locale";
import { getLearnGuides } from "@/lib/learn/repository";
import { SITE_NAME, SITE_URL, buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Learn",
  description:
    "Read practical Listflow guides for Etsy automation, extension workflows, subscription setup, shipping operations, and store scaling.",
  path: "/learn",
  type: "website",
  keywords: [
    "etsy automation guide",
    "etsy extension tutorial",
    "listflow learn",
    "etsy store operations guide",
  ],
});

export default async function LearnPage() {
  const locale = detectLocale(await cookies(), await headers());
  const guides = await getLearnGuides();
  const firstGuide = guides[0];

  if (!firstGuide) {
    notFound();
  }

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${SITE_NAME} Learn`,
          url: `${SITE_URL}/learn`,
          hasPart: guides.slice(0, 20).map((guide) => ({
            "@type": "Article",
            headline: guide.title.en,
            url: `${SITE_URL}/learn/${guide.slug}`,
          })),
        }}
      />
      <LearnDocsView locale={locale} activeGuide={firstGuide} guides={guides} />
    </>
  );
}
