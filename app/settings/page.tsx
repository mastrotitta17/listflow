import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function SettingsPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
