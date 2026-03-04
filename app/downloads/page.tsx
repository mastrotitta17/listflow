import { cookies, headers } from "next/headers";
import { detectLocale } from "@/lib/i18n/detect-locale";
import DownloadsShowcase from "@/components/Downloads/DownloadsShowcase";

export default async function DownloadsPage() {
  const locale = detectLocale(await cookies(), await headers());
  return <DownloadsShowcase initialLocale={locale} />;
}
