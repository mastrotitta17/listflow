import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

type CategoriesSlugPageProps = {
  params: Promise<{
    categorySlug: string;
  }>;
};

export default async function CategoriesSlugPage({ params }: CategoriesSlugPageProps) {
  const { categorySlug } = await params;
  const normalizedCategorySlug = decodeURIComponent(categorySlug || "").trim();

  return (
    <DashboardRouteView
      section={DashboardSection.CATEGORIES}
      categorySlug={normalizedCategorySlug || null}
    />
  );
}
