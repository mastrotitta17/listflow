import { NextRequest, NextResponse } from "next/server";
import { getGeoStates } from "@/lib/geo/location-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const countryCode = request.nextUrl.searchParams.get("country")?.trim().toUpperCase() ?? "";

  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return NextResponse.json({ error: "country query param must be ISO2 code" }, { status: 400 });
  }

  return NextResponse.json({
    rows: getGeoStates(countryCode),
  });
}
