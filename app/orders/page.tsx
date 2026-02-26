import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function OrdersPage() {
  return <DashboardRouteView section={DashboardSection.ORDERS} />;
}
