import { NextRequest, NextResponse } from "next/server";
import { getGeoCities } from "@/lib/geo/location-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseLimit = (rawValue: string | null) => {
  if (!rawValue) {
    return 3000;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3000;
  }

  return Math.min(Math.round(parsed), 5000);
};

export async function GET(request: NextRequest) {
  const countryCode = request.nextUrl.searchParams.get("country")?.trim().toUpperCase() ?? "";
  const stateCode = request.nextUrl.searchParams.get("state")?.trim().toUpperCase() ?? "";
  const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return NextResponse.json({ error: "country query param must be ISO2 code" }, { status: 400 });
  }

  const allRows = getGeoCities({
    countryCode,
    stateCode: stateCode || null,
  });

  const filteredRows = query
    ? allRows.filter((city) => city.name.toLowerCase().includes(query))
    : allRows;

  return NextResponse.json({
    rows: filteredRows.slice(0, limit),
    meta: {
      total: filteredRows.length,
      limited: filteredRows.length > limit,
    },
  });
}
