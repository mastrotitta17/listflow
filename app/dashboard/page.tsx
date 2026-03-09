import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Dashboard", "/dashboard");

export default function DashboardPage() {
  return <DashboardRouteView section={DashboardSection.HOME} />;
}
