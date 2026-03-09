import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { getLearnGuides } from "@/lib/learn/repository";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const guides = await getLearnGuides();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/downloads`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/learn`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/policies/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/policies/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const guideRoutes: MetadataRoute.Sitemap = guides.map((guide) => ({
    url: `${SITE_URL}/learn/${guide.slug}`,
    lastModified: new Date(guide.updatedAt || now),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...guideRoutes];
}
