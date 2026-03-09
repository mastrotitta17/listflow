import { DashboardChromeSkeleton, OrdersPanelSkeleton } from '@/components/loading/PageSkeletons';

export default function Loading() {
  return <DashboardChromeSkeleton><OrdersPanelSkeleton /></DashboardChromeSkeleton>;
}
