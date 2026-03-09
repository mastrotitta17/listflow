import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("eBay Automation", "/ebay-automation");

export default function EbayAutomationPage() {
  return <DashboardRouteView section={DashboardSection.EBAY_AUTOMATION} />;
}
