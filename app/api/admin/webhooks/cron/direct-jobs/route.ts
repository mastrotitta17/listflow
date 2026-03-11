import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { loadSchedulerMasterState } from "@/lib/cron-job-org/client";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const schedulerState = await loadSchedulerMasterState();
    const rows = schedulerState?.jobId
      ? [
          {
            jobId: schedulerState.jobId,
            enabled: schedulerState.active,
            title: "Listflow Master Scheduler",
            url: `${schedulerState.schedulerBaseUrl ?? ""}/api/scheduler/tick`,
            requestMethod: 1,
            lastStatus: schedulerState.lastRunStatus === "succeeded" ? 1 : schedulerState.lastRunStatus ? 2 : 0,
            lastDuration: null,
            lastExecution: schedulerState.lastRunStartedAt
              ? Math.floor(new Date(schedulerState.lastRunStartedAt).getTime() / 1000)
              : null,
            nextExecution: null,
            schedule: null,
            subscriptionId: null,
            storeId: null,
            webhookConfigId: null,
            plan: null,
          },
        ]
      : [];
    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master scheduler bilgisi yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
