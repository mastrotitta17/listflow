import { DashboardChromeSkeleton, DashboardHomePanelSkeleton } from "@/components/loading/PageSkeletons";

export default function DashboardLoading() {
  return (
    <DashboardChromeSkeleton>
      <DashboardHomePanelSkeleton />
    </DashboardChromeSkeleton>
  );
}
