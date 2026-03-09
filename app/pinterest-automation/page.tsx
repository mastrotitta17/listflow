import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Pinterest Automation", "/pinterest-automation");

export default function PinterestAutomationPage() {
  return <DashboardRouteView section={DashboardSection.PINTEREST_AUTOMATION} />;
}
