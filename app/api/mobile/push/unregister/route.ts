import { NextRequest, NextResponse } from "next/server";
import { deactivateMobilePushTokens, isExpoPushToken } from "@/lib/mobile/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      expoPushToken?: string;
    };

    if (!isExpoPushToken(body.expoPushToken)) {
      return NextResponse.json({ error: "Geçersiz Expo push token." }, { status: 400 });
    }

    await deactivateMobilePushTokens([body.expoPushToken!]);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push token pasifleştirilemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
