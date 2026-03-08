import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function ProductsPage() {
  return <DashboardRouteView section={DashboardSection.PRODUCTS} />;
}
