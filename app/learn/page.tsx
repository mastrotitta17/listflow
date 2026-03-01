import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import LearnDocsView from "@/components/Learn/LearnDocsView";
import { detectLocale } from "@/lib/i18n/detect-locale";
import { getLearnGuides } from "@/lib/learn/repository";

export default async function LearnPage() {
  const locale = detectLocale(await cookies(), await headers());
  const guides = await getLearnGuides();
  const firstGuide = guides[0];

  if (!firstGuide) {
    notFound();
  }

  return <LearnDocsView locale={locale} activeGuide={firstGuide} guides={guides} />;
}
