import JsonLd from "@/components/seo/JsonLd";
import PricingPage from "@/components/PricingPage";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, absoluteUrl, buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Pricing",
  description:
    "Explore Listflow pricing for Etsy automation, listing workflows, store scaling, and operational control with starter, pro, and turbo plans.",
  path: "/pricing",
  keywords: [
    "etsy automation pricing",
    "etsy software pricing",
    "listflow pricing",
    "etsy listing subscription",
  ],
});

export default function PricingRoute() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: `${SITE_URL}/pricing`,
          image: absoluteUrl(DEFAULT_OG_IMAGE),
          offers: [
            { "@type": "Offer", priceCurrency: "USD", availability: "https://schema.org/InStock", category: "Starter plan" },
            { "@type": "Offer", priceCurrency: "USD", availability: "https://schema.org/InStock", category: "Pro plan" },
            { "@type": "Offer", priceCurrency: "USD", availability: "https://schema.org/InStock", category: "Turbo plan" },
          ],
        }}
      />
      <PricingPage />
    </>
  );
}
