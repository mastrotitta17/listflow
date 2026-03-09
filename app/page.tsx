import HomePageClient from "@/components/HomePageClient";
import JsonLd from "@/components/seo/JsonLd";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, absoluteUrl, buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "AI Etsy Automation Platform",
  description:
    "Generate products, scale Etsy store operations, automate listing workflows, and manage subscription-ready store growth from a single control center.",
  path: "/",
  keywords: [
    "etsy automation software",
    "etsy listing workflow",
    "etsy ai automation",
    "etsy seller dashboard",
    "etsy store growth",
  ],
});

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl(DEFAULT_OG_IMAGE),
  image: absoluteUrl(DEFAULT_OG_IMAGE),
  email: "contact@listflow.pro",
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description:
    "Listflow helps Etsy sellers generate products, manage store automation, publish listings, and track operations from one control center.",
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
  },
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  image: absoluteUrl(DEFAULT_OG_IMAGE),
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationJsonLd, webSiteJsonLd, softwareJsonLd]} />
      <HomePageClient />
    </>
  );
}
