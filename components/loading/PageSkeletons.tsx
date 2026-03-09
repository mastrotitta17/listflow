import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

const Shell = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`min-h-screen min-h-[100dvh] bg-[#0a0a0c] text-white ${className}`}>{children}</div>
);

const GlassCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-[24px] border border-white/10 bg-white/5 backdrop-blur-xl ${className}`}>{children}</div>
);

export const DashboardChromeSkeleton = ({ children }: { children: React.ReactNode }) => (
  <Shell>
    <div className="flex min-h-screen min-h-[100dvh] w-full overflow-hidden">
      <aside className="hidden xl:flex xl:w-[280px] xl:shrink-0 xl:flex-col xl:border-r xl:border-white/10 xl:bg-[#0d111b] xl:p-5">
        <Skeleton className="h-10 w-36 rounded-2xl bg-white/10" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-2xl bg-white/10" />
          ))}
        </div>
        <div className="mt-auto space-y-3 pt-8">
          <Skeleton className="h-24 w-full rounded-3xl bg-white/10" />
          <Skeleton className="h-11 w-full rounded-2xl bg-white/10" />
          <Skeleton className="h-11 w-full rounded-2xl bg-white/10" />
        </div>
      </aside>

      <div className="flex min-h-screen min-h-[100dvh] flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 xl:hidden">
          <Skeleton className="h-10 w-10 rounded-2xl bg-white/10" />
          <Skeleton className="h-6 w-28 rounded-full bg-white/10" />
          <Skeleton className="h-10 w-10 rounded-2xl bg-white/10" />
        </div>
        <main className="flex-1 overflow-hidden px-4 py-4 sm:px-5 sm:py-5 lg:px-6">{children}</main>
      </div>
    </div>
  </Shell>
);

export const HomePageSkeleton = () => (
  <Shell>
    <div className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-36 rounded-2xl bg-white/10" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-28 rounded-2xl bg-white/10" />
          <Skeleton className="h-10 w-32 rounded-2xl bg-white/10" />
        </div>
      </div>
      <GlassCard className="relative overflow-hidden p-6 sm:p-8 lg:p-10">
        <Skeleton className="h-5 w-32 rounded-full bg-white/10" />
        <Skeleton className="mt-5 h-14 w-full max-w-2xl rounded-[28px] bg-white/10" />
        <Skeleton className="mt-3 h-14 w-full max-w-xl rounded-[28px] bg-white/10" />
        <Skeleton className="mt-6 h-5 w-full max-w-3xl rounded-full bg-white/10" />
        <Skeleton className="mt-2 h-5 w-full max-w-2xl rounded-full bg-white/10" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Skeleton className="h-12 w-44 rounded-2xl bg-white/10" />
          <Skeleton className="h-12 w-40 rounded-2xl bg-white/10" />
        </div>
      </GlassCard>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <GlassCard key={index} className="p-5">
            <Skeleton className="h-36 w-full rounded-[24px] bg-white/10" />
            <Skeleton className="mt-5 h-5 w-2/3 rounded-full bg-white/10" />
            <Skeleton className="mt-3 h-4 w-full rounded-full bg-white/10" />
            <Skeleton className="mt-2 h-4 w-4/5 rounded-full bg-white/10" />
          </GlassCard>
        ))}
      </div>
    </div>
  </Shell>
);

export const AuthPageSkeleton = () => (
  <Shell className="overflow-hidden">
    <div className="grid min-h-screen min-h-[100dvh] grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="hidden lg:block border-r border-white/10 bg-[#0d111b] p-10">
        <Skeleton className="h-10 w-36 rounded-2xl bg-white/10" />
        <Skeleton className="mt-16 h-12 w-56 rounded-full bg-white/10" />
        <Skeleton className="mt-6 h-16 w-3/4 rounded-[30px] bg-white/10" />
        <Skeleton className="mt-4 h-6 w-2/3 rounded-full bg-white/10" />
        <div className="mt-10 space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-[28px] bg-white/10" />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-6 sm:px-6 lg:px-10">
        <GlassCard className="w-full max-w-xl p-5 sm:p-8">
          <Skeleton className="h-8 w-40 rounded-full bg-white/10" />
          <Skeleton className="mt-3 h-4 w-56 rounded-full bg-white/10" />
          <div className="mt-8 space-y-4">
            <Skeleton className="h-[52px] w-full rounded-2xl bg-white/10" />
            <Skeleton className="h-[52px] w-full rounded-2xl bg-white/10" />
            <Skeleton className="h-[52px] w-full rounded-2xl bg-white/10" />
            <Skeleton className="h-[52px] w-full rounded-2xl bg-white/10" />
          </div>
        </GlassCard>
      </div>
    </div>
  </Shell>
);

export const LegacyOnboardingSkeleton = () => (
  <Shell>
    <div className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-5xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
      <GlassCard className="w-full p-5 sm:p-8 lg:p-10">
        <Skeleton className="h-10 w-56 rounded-full bg-white/10" />
        <Skeleton className="mt-4 h-5 w-72 rounded-full bg-white/10" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
          <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
          <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
          <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Skeleton className="h-12 w-32 rounded-2xl bg-white/10" />
          <Skeleton className="h-12 w-44 rounded-2xl bg-white/10" />
        </div>
      </GlassCard>
    </div>
  </Shell>
);

export const OrdersPanelSkeleton = () => (
  <div className="flex h-full flex-col p-5">
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-3">
        <Skeleton className="h-10 w-44 rounded-full bg-white/10" />
        <Skeleton className="h-4 w-72 rounded-full bg-white/10" />
      </div>
      <Skeleton className="h-12 w-full rounded-2xl bg-white/10 sm:w-44" />
    </div>
    <div className="mb-6 flex gap-4">
      <Skeleton className="h-12 flex-1 rounded-2xl bg-white/10" />
      <Skeleton className="h-12 w-36 rounded-2xl bg-white/10" />
    </div>
    <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
      {Array.from({ length: 4 }).map((_, index) => (
        <GlassCard key={index} className="p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-2xl bg-white/10" />
              <div className="space-y-3">
                <Skeleton className="h-5 w-56 rounded-full bg-white/10" />
                <Skeleton className="h-4 w-72 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-28 rounded-2xl bg-white/10" />
              <Skeleton className="h-12 w-32 rounded-2xl bg-white/10" />
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  </div>
);

export const ProductsPanelSkeleton = () => (
  <div className="h-full overflow-y-auto px-1 pb-6">
    <div className="space-y-5 rounded-[28px] border border-white/10 bg-[#0f1422]/95 p-4 sm:p-5 lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-10 w-44 rounded-full bg-white/10" />
          <Skeleton className="h-4 w-64 rounded-full bg-white/10" />
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
          <Skeleton className="h-12 w-full rounded-2xl bg-white/10 lg:w-64" />
          <Skeleton className="h-12 w-full rounded-2xl bg-white/10 lg:w-72" />
          <Skeleton className="h-12 w-full rounded-2xl bg-white/10 lg:w-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 [@media(min-width:1850px)]:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <GlassCard key={index} className="overflow-hidden">
            <Skeleton className="aspect-[4/3.5] w-full bg-white/10" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-3/4 rounded-full bg-white/10" />
              <Skeleton className="h-4 w-full rounded-full bg-white/10" />
              <Skeleton className="h-4 w-2/3 rounded-full bg-white/10" />
              <Skeleton className="h-10 w-32 rounded-2xl bg-white/10" />
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  </div>
);

export const SettingsPanelSkeleton = () => (
  <div className="h-full w-full overflow-y-auto custom-scrollbar pr-0 pt-2 sm:pr-2">
    <div className="space-y-6 pb-8">
      <GlassCard className="p-5 sm:p-7">
        <Skeleton className="h-6 w-40 rounded-full bg-white/10" />
        <Skeleton className="mt-4 h-10 w-full max-w-2xl rounded-[28px] bg-white/10" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-2xl bg-white/10" />
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
            <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
            <Skeleton className="h-36 w-full rounded-[28px] bg-white/10" />
            <Skeleton className="h-12 w-40 rounded-2xl bg-white/10" />
          </div>
        </div>
      </GlassCard>
    </div>
  </div>
);

export const ReferralPanelSkeleton = () => (
  <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 lg:px-10">
      <GlassCard className="p-8">
        <Skeleton className="h-8 w-44 rounded-full bg-white/10" />
        <Skeleton className="mt-4 h-12 w-full max-w-2xl rounded-[28px] bg-white/10" />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-[28px] bg-white/10" />
          ))}
        </div>
      </GlassCard>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <GlassCard className="p-6">
          <Skeleton className="h-72 w-full rounded-[28px] bg-white/10" />
        </GlassCard>
        <GlassCard className="p-6">
          <Skeleton className="h-10 w-40 rounded-full bg-white/10" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-[24px] bg-white/10" />
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  </div>
);

export const CategoriesPanelSkeleton = () => (
  <div className="h-full overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
    <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
      <GlassCard className="p-4">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-2xl bg-white/10" />
          ))}
        </div>
      </GlassCard>
      <GlassCard className="p-5 sm:p-6">
        <Skeleton className="h-10 w-56 rounded-full bg-white/10" />
        <Skeleton className="mt-4 h-5 w-72 rounded-full bg-white/10" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-48 w-full rounded-[28px] bg-white/10" />
          ))}
        </div>
      </GlassCard>
    </div>
  </div>
);

export const EtsyPanelSkeleton = () => (
  <div className="w-full p-5 h-full overflow-y-auto custom-scrollbar">
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-3">
        <Skeleton className="h-10 w-52 rounded-full bg-white/10" />
        <Skeleton className="h-4 w-72 rounded-full bg-white/10" />
      </div>
      <Skeleton className="h-[52px] w-full rounded-2xl bg-white/10 md:w-48" />
    </div>
    <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2">
      <Skeleton className="h-24 w-full rounded-[20px] bg-white/10" />
      <Skeleton className="h-24 w-full rounded-[20px] bg-white/10" />
    </div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <GlassCard key={index} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <Skeleton className="h-6 w-48 rounded-full bg-white/10" />
              <Skeleton className="h-4 w-32 rounded-full bg-white/10" />
            </div>
            <Skeleton className="h-10 w-10 rounded-2xl bg-white/10" />
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20 w-full rounded-[24px] bg-white/10" />
            <Skeleton className="h-20 w-full rounded-[24px] bg-white/10" />
          </div>
          <div className="mt-6 flex gap-3">
            <Skeleton className="h-11 flex-1 rounded-2xl bg-white/10" />
            <Skeleton className="h-11 flex-1 rounded-2xl bg-white/10" />
          </div>
        </GlassCard>
      ))}
    </div>
  </div>
);

export const LearnPageSkeleton = () => (
  <Shell>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <GlassCard className="p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="mb-3 h-10 w-full rounded-2xl bg-white/10" />
          ))}
        </GlassCard>
        <GlassCard className="p-6">
          <Skeleton className="h-10 w-64 rounded-full bg-white/10" />
          <Skeleton className="mt-4 h-5 w-72 rounded-full bg-white/10" />
          <Skeleton className="mt-8 h-[420px] w-full rounded-[28px] bg-white/10" />
        </GlassCard>
      </div>
    </div>
  </Shell>
);

export const PricingPageSkeleton = () => (
  <Shell>
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-4 text-center">
        <Skeleton className="mx-auto h-6 w-40 rounded-full bg-white/10" />
        <Skeleton className="mx-auto h-14 w-full max-w-2xl rounded-[28px] bg-white/10" />
        <Skeleton className="mx-auto h-5 w-full max-w-3xl rounded-full bg-white/10" />
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <GlassCard key={index} className="p-6">
            <Skeleton className="h-8 w-24 rounded-full bg-white/10" />
            <Skeleton className="mt-6 h-16 w-36 rounded-[28px] bg-white/10" />
            <div className="mt-8 space-y-4">
              {Array.from({ length: 5 }).map((_, featureIndex) => (
                <Skeleton key={featureIndex} className="h-4 w-full rounded-full bg-white/10" />
              ))}
            </div>
            <Skeleton className="mt-8 h-12 w-full rounded-2xl bg-white/10" />
          </GlassCard>
        ))}
      </div>
    </div>
  </Shell>
);

export const DownloadsPageSkeleton = () => (
  <Shell>
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <GlassCard className="min-h-[70vh] p-6 sm:p-8 lg:p-10">
        <Skeleton className="h-[52vh] w-full rounded-[36px] bg-white/10" />
        <Skeleton className="mt-8 h-14 w-full max-w-2xl rounded-[28px] bg-white/10" />
        <Skeleton className="mt-4 h-5 w-full max-w-3xl rounded-full bg-white/10" />
      </GlassCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[420px] w-full rounded-[32px] bg-white/10" />
        <Skeleton className="h-[420px] w-full rounded-[32px] bg-white/10" />
      </div>
    </div>
  </Shell>
);

export const PaymentSuccessPageSkeleton = () => (
  <Shell>
    <div className="mx-auto flex min-h-screen min-h-[100dvh] max-w-3xl items-center justify-center px-4 py-6">
      <GlassCard className="w-full p-6 text-center sm:p-8 lg:p-10">
        <Skeleton className="mx-auto h-16 w-16 rounded-full bg-white/10" />
        <Skeleton className="mx-auto mt-6 h-10 w-64 rounded-full bg-white/10" />
        <Skeleton className="mx-auto mt-4 h-5 w-72 rounded-full bg-white/10" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24 w-full rounded-[28px] bg-white/10" />
          <Skeleton className="h-24 w-full rounded-[28px] bg-white/10" />
        </div>
      </GlassCard>
    </div>
  </Shell>
);

export const AutomationPageSkeleton = () => (
  <DashboardChromeSkeleton>
    <div className="space-y-6 p-1">
      <GlassCard className="p-6 sm:p-8">
        <Skeleton className="h-10 w-56 rounded-full bg-white/10" />
        <Skeleton className="mt-4 h-5 w-72 rounded-full bg-white/10" />
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full rounded-[28px] bg-white/10" />
          ))}
        </div>
      </GlassCard>
    </div>
  </DashboardChromeSkeleton>
);

export const PolicyPageSkeleton = () => (
  <Shell>
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <GlassCard className="p-6 sm:p-8 lg:p-10">
        <Skeleton className="h-10 w-56 rounded-full bg-white/10" />
        <div className="mt-8 space-y-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className={`h-4 rounded-full bg-white/10 ${index % 3 === 0 ? 'w-3/4' : index % 3 === 1 ? 'w-full' : 'w-5/6'}`} />
          ))}
        </div>
      </GlassCard>
    </div>
  </Shell>
);
