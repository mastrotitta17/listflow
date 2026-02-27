import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function SettingsSecurityPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
