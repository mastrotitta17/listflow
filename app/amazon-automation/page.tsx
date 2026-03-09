import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Amazon Automation", "/amazon-automation");

export default function AmazonAutomationPage() {
  return <DashboardRouteView section={DashboardSection.AMAZON_AUTOMATION} />;
}
