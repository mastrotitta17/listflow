import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireAdminRequest } from "@/lib/auth/admin-request";
import { loadActiveMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile/push";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeString = (value: unknown) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

const maskToken = (value: string) => {
  if (value.length <= 20) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-6)}`;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const [tokenResult, messageResult] = await Promise.all([
      supabaseAdmin
        .from("mobile_push_tokens")
        .select("id,user_id,expo_push_token,platform,device_name,app_version,last_seen_at,is_active")
        .order("last_seen_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("mobile_push_messages")
        .select("id,created_at,audience,title,body,deeplink_url,requested_count,success_count,failure_count")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (tokenResult.error) {
      throw new Error(tokenResult.error.message ?? "Push cihazları yüklenemedi.");
    }

    if (messageResult.error) {
      throw new Error(messageResult.error.message ?? "Push geçmişi yüklenemedi.");
    }

    const tokens = tokenResult.data ?? [];
    const userIds = Array.from(new Set(tokens.map((row) => row.user_id).filter(Boolean)));
    const profilesResult = userIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("user_id,full_name,email")
          .in("user_id", userIds)
      : { data: [], error: null };

    if (profilesResult.error) {
      throw new Error(profilesResult.error.message ?? "Push kullanıcıları yüklenemedi.");
    }

    const profilesByUserId = new Map(
      (profilesResult.data ?? []).map((row) => [
        row.user_id,
        {
          fullName: row.full_name ?? null,
          email: row.email ?? null,
        },
      ])
    );

    const users = Array.from(
      tokens.reduce((map, row) => {
        const current = map.get(row.user_id) ?? {
          userId: row.user_id,
          fullName: profilesByUserId.get(row.user_id)?.fullName ?? null,
          email: profilesByUserId.get(row.user_id)?.email ?? null,
          activeDeviceCount: 0,
          lastSeenAt: row.last_seen_at,
        };

        if (row.is_active) {
          current.activeDeviceCount += 1;
        }

        if (!current.lastSeenAt || new Date(row.last_seen_at).getTime() > new Date(current.lastSeenAt).getTime()) {
          current.lastSeenAt = row.last_seen_at;
        }

        map.set(row.user_id, current);
        return map;
      }, new Map<string, { userId: string; fullName: string | null; email: string | null; activeDeviceCount: number; lastSeenAt: string | null }>())
        .values()
    ).sort((a, b) => b.activeDeviceCount - a.activeDeviceCount);

    return NextResponse.json({
      stats: {
        activeDevices: tokens.filter((row) => row.is_active).length,
        activeUsers: users.filter((row) => row.activeDeviceCount > 0).length,
        recentMessages: (messageResult.data ?? []).length,
      },
      devices: tokens.map((row) => ({
        id: row.id,
        userId: row.user_id,
        expoPushToken: maskToken(row.expo_push_token),
        platform: row.platform,
        deviceName: row.device_name,
        appVersion: row.app_version,
        lastSeenAt: row.last_seen_at,
        isActive: row.is_active,
      })),
      users,
      messages: messageResult.data ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push verileri yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      body?: unknown;
      audience?: unknown;
      userId?: unknown;
      deeplinkUrl?: unknown;
      data?: unknown;
    };

    const title = normalizeString(body.title);
    const messageBody = normalizeString(body.body);
    const audience = normalizeString(body.audience) === "user" ? "user" : "all";
    const userId = audience === "user" ? normalizeString(body.userId) : null;
    const deeplinkUrl = normalizeString(body.deeplinkUrl);
    const payloadData =
      typeof body.data === "object" && body.data !== null && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : {};

    if (!title || !messageBody) {
      return NextResponse.json({ error: "Başlık ve mesaj zorunlu." }, { status: 400 });
    }

    if (audience === "user" && !userId) {
      return NextResponse.json({ error: "Kullanıcı seçimi zorunlu." }, { status: 400 });
    }

    const tokens = await loadActiveMobilePushTokens({ userId });
    const tokenValues = tokens.map((row) => row.expo_push_token);

    if (!tokenValues.length) {
      return NextResponse.json({ error: "Seçilen hedef için kayıtlı aktif mobil cihaz bulunamadı." }, { status: 400 });
    }

    const result = await sendMobilePushNotifications({
      title,
      body: messageBody,
      deeplinkUrl,
      data: payloadData,
      tokens: tokenValues,
    });

    const logInsert = await supabaseAdmin.from("mobile_push_messages").insert({
      created_by: admin.user.id,
      audience,
      title,
      body: messageBody,
      deeplink_url: deeplinkUrl,
      payload: {
        ...payloadData,
        userId,
      },
      requested_count: result.requestedCount,
      success_count: result.successCount,
      failure_count: result.failureCount,
      response: {
        invalidatedTokens: result.invalidatedTokens,
        tickets: result.tickets,
      },
    });

    if (logInsert.error) {
      throw new Error(logInsert.error.message ?? "Push log kaydı yazılamadı.");
    }

    return NextResponse.json({
      success: true,
      message: "Push bildirimi gönderildi.",
      summary: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push bildirimi gönderilemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
