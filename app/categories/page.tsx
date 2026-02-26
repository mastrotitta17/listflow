import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function CategoriesPage() {
  return <DashboardRouteView section={DashboardSection.CATEGORIES} />;
}
