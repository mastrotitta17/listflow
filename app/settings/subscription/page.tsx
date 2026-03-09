import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Settings Subscription", "/settings/subscription");

export default function SettingsSubscriptionPage() {
  return <DashboardRouteView section={DashboardSection.SETTINGS} />;
}
