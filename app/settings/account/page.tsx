import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function SettingsAccountPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
