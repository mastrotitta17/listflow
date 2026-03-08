import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

export const runtime = "nodejs";

const getBearerToken = (authHeader: string | null) => {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const normalizeTokenCandidate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  return value.trim().replace(/ /g, "+");
};

const isAuthorized = (request: NextRequest) => {
  const headerToken = normalizeTokenCandidate(getBearerToken(request.headers.get("authorization")));
  const altHeaderToken = normalizeTokenCandidate(request.headers.get("x-cron-secret"));
  const queryToken = normalizeTokenCandidate(
    request.nextUrl.searchParams.get("cron_secret") ??
      request.nextUrl.searchParams.get("secret") ??
      null
  );

  const providedTokens = [headerToken, altHeaderToken, queryToken].filter((token): token is string => Boolean(token));
  return providedTokens.some((token) => token === serverEnv.CRON_SECRET);
};

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncSchedulerCronJobLifecycle({ force: true });
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status === "skipped" ? 202 : 500,
    headers: {
      "cache-control": "no-store",
    },
  });
}
