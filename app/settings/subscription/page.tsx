import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function SettingsSubscriptionPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
