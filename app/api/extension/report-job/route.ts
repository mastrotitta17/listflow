import { NextRequest, NextResponse } from "next/server";
import { applyListingJobReport } from "@/lib/extension/listing-queue";
import { resolveExtensionUser } from "@/lib/extension/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportJobBody = {
  job_id?: unknown;
  type?: unknown;
  status?: unknown;
  step?: unknown;
  listing_id?: unknown;
  listing_key?: unknown;
  error?: unknown;
  etsy_refs?: {
    listing_id?: unknown;
    listing_url?: unknown;
  } | null;
};

const toTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const resolveStatus = (body: ReportJobBody) => {
  const rawStatus = toTrimmed(body.status).toLowerCase();
  if (rawStatus === "done" || rawStatus === "success" || rawStatus === "completed") {
    return "completed" as const;
  }
  if (rawStatus === "error" || rawStatus === "failed") {
    return "failed" as const;
  }

  const step = toTrimmed(body.step).toLowerCase();
  if (step.includes("done") || step.includes("success")) {
    return "completed" as const;
  }
  if (step.includes("error") || step.includes("failed")) {
    return "failed" as const;
  }

  return "processing" as const;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveExtensionUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as ReportJobBody;
    const jobType = toTrimmed(body.type).toUpperCase();
    if (jobType && jobType !== "LISTING_CREATE") {
      return NextResponse.json(
        {
          ok: true,
          ignored: true,
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        }
      );
    }

    const reportStatus = resolveStatus(body);
    const listingId = toTrimmed(body.listing_id) || toTrimmed(body.etsy_refs?.listing_id);
    const listingKey = toTrimmed(body.listing_key);
    const listingUrl = toTrimmed(body.etsy_refs?.listing_url);
    const reportError = toTrimmed(body.error) || null;

    const result = await applyListingJobReport({
      userId: auth.user.id,
      listingId: listingId || null,
      listingKey: listingKey || null,
      status: reportStatus,
      error: reportError,
      etsyListingId: toTrimmed(body.etsy_refs?.listing_id) || null,
      etsyListingUrl: listingUrl || null,
    });

    return NextResponse.json(
      {
        ok: true,
        result,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process job report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
