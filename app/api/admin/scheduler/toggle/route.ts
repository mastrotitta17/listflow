import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { setSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolveEnabledValue = async (request: NextRequest) => {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { enabled?: boolean | string } | null;
    if (typeof body?.enabled === "boolean") {
      return body.enabled;
    }
    if (typeof body?.enabled === "string") {
      return body.enabled === "true" || body.enabled === "1" || body.enabled === "enable";
    }
    return null;
  }

  const formData = await request.formData().catch(() => null);
  const raw = formData?.get("enabled");
  if (typeof raw !== "string") {
    return null;
  }

  return raw === "true" || raw === "1" || raw === "enable";
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const enabled = await resolveEnabledValue(request);
  if (enabled === null) {
    return NextResponse.redirect(new URL("/admin?scheduler=invalid", request.nextUrl.origin), { status: 303 });
  }

  const result = await setSchedulerCronJobLifecycle(enabled);
  const redirectUrl = new URL("/admin", request.nextUrl.origin);
  redirectUrl.searchParams.set("scheduler", result.ok ? (enabled ? "enabled" : "disabled") : "error");
  if (!result.ok && result.message) {
    redirectUrl.searchParams.set("schedulerMessage", result.message);
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
