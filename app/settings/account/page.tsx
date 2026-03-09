import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Settings Account", "/settings/account");

export default function SettingsAccountPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
