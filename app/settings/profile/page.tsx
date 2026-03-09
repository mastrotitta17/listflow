import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Settings Profile", "/settings/profile");

export default function SettingsProfilePage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
