import type { MetadataRoute } from "next";
import { SITE_DOMAIN, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    host: SITE_DOMAIN,
    sitemap: `${SITE_URL}/sitemap.xml`,
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/downloads", "/learn", "/policies/privacy", "/policies/terms"],
        disallow: [
          "/admin",
          "/admin/*",
          "/api",
          "/api/*",
          "/dashboard",
          "/dashboard/*",
          "/categories",
          "/categories/*",
          "/etsy-automation",
          "/products",
          "/orders",
          "/settings",
          "/settings/*",
          "/referral",
          "/amazon-automation",
          "/ebay-automation",
          "/meta-automation",
          "/pinterest-automation",
          "/legacy-onboarding",
          "/payment-success",
          "/login",
          "/auth",
          "/auth/*",
        ],
      },
    ],
  };
}
