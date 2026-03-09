import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Settings Security", "/settings/security");

export default function SettingsSecurityPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
