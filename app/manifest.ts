import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description:
      "Listflow helps Etsy sellers generate products, manage store automation, publish listings, and track operations from one control center.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    categories: ["business", "productivity", "utilities"],
    lang: "en",
    orientation: "portrait",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/og-image.jpg",
        sizes: "1200x630",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
    id: SITE_URL,
  };
}
