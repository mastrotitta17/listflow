import DashboardRouteView from "@/components/Dashboard/DashboardRouteView";
import { DashboardSection } from "@/types";

export default function ReferralPage() {
  return <DashboardRouteView section={DashboardSection.REFERRAL} />;
}
