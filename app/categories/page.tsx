import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Categories", "/categories");

export default function CategoriesPage() {
  return <DashboardRouteView section={DashboardSection.CATEGORIES} />;
}
