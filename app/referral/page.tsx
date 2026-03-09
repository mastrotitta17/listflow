import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { buildPrivateMetadata } from "@/lib/seo";
import { DashboardSection } from "@/types";

export const metadata = buildPrivateMetadata("Referral", "/referral");

export default function ReferralPage() {
  return <DashboardRouteView section={DashboardSection.REFERRAL} />;
}
