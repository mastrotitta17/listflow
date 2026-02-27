import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function SettingsProfilePage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
