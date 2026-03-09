import { cookies, headers } from "next/headers";
import { detectLocale } from "@/lib/i18n/detect-locale";
import DownloadsShowcase from "@/components/Downloads/DownloadsShowcase";
import JsonLd from "@/components/seo/JsonLd";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, absoluteUrl, buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Downloads",
  description:
    "Download the Listflow mobile and extension experience, review onboarding assets, and explore the product workflow across web, mobile, and Chrome.",
  path: "/downloads",
  keywords: [
    "listflow download",
    "etsy extension download",
    "etsy mobile app",
    "listflow mobile",
  ],
});

export default async function DownloadsPage() {
  const locale = detectLocale(await cookies(), await headers());
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          operatingSystem: "iOS, Android, Chrome, Web",
          applicationCategory: "BusinessApplication",
          url: `${SITE_URL}/downloads`,
          image: absoluteUrl(DEFAULT_OG_IMAGE),
        }}
      />
      <DownloadsShowcase initialLocale={locale} />
    </>
  );
}
