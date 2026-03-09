import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Meta Automation", "/meta-automation");

export default function MetaAutomationPage() {
  return <DashboardRouteView section={DashboardSection.META_AUTOMATION} />;
}
