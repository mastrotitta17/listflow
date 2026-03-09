import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { isExpoPushToken, upsertMobilePushToken } from "@/lib/mobile/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      expoPushToken?: string;
      platform?: string;
      deviceName?: string | null;
      deviceModel?: string | null;
      osName?: string | null;
      osVersion?: string | null;
      appVersion?: string | null;
      appBuild?: string | null;
      appId?: string | null;
      projectId?: string | null;
      locale?: string | null;
    };

    if (!isExpoPushToken(body.expoPushToken)) {
      return NextResponse.json({ error: "Geçersiz Expo push token." }, { status: 400 });
    }

    await upsertMobilePushToken({
      userId: user.id,
      payload: {
        expoPushToken: body.expoPushToken!,
        platform: body.platform ?? "unknown",
        deviceName: body.deviceName ?? null,
        deviceModel: body.deviceModel ?? null,
        osName: body.osName ?? null,
        osVersion: body.osVersion ?? null,
        appVersion: body.appVersion ?? null,
        appBuild: body.appBuild ?? null,
        appId: body.appId ?? null,
        projectId: body.projectId ?? null,
        locale: body.locale ?? null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push token kaydedilemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
