import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Orders", "/orders");

export default function OrdersPage() {
  return <DashboardRouteView section={DashboardSection.ORDERS} />;
}
