import { NextResponse } from "next/server";
import { getGeoCountries } from "@/lib/geo/location-data";

export const runtime = "nodejs";
export const revalidate = 60 * 60 * 24;

export async function GET() {
  return NextResponse.json({
    rows: getGeoCountries(),
  });
}
