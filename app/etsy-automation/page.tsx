import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Etsy Automation", "/etsy-automation");

export default function EtsyAutomationPage() {
  return <DashboardRouteView section={DashboardSection.ETSY_AUTOMATION} />;
}
