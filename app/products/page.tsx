import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Products", "/products");

export default function ProductsPage() {
  return <DashboardRouteView section={DashboardSection.PRODUCTS} />;
}
