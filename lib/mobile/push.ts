import { serverEnv } from "@/lib/env/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN_PATTERN = /^ExponentPushToken\[[^\]]+\]$/;
const EXPO_CHUNK_SIZE = 100;

export type MobilePushTokenPayload = {
  expoPushToken: string;
  platform: string;
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

export type SendMobilePushArgs = {
  title: string;
  body: string;
  deeplinkUrl?: string | null;
  data?: Record<string, unknown>;
  tokens: string[];
};

export type SendMobilePushResult = {
  requestedCount: number;
  successCount: number;
  failureCount: number;
  invalidatedTokens: string[];
  tickets: Array<Record<string, unknown>>;
};

const chunk = <T,>(items: T[], size: number) => {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
};

const normalizeString = (value: string | null | undefined) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

export const isExpoPushToken = (value: string | null | undefined) => {
  const normalized = normalizeString(value);
  return Boolean(normalized && EXPO_PUSH_TOKEN_PATTERN.test(normalized));
};

export const upsertMobilePushToken = async (args: {
  userId: string;
  payload: MobilePushTokenPayload;
}) => {
  const token = normalizeString(args.payload.expoPushToken);
  if (!token || !isExpoPushToken(token)) {
    throw new Error("Geçersiz Expo push token.");
  }

  const now = new Date().toISOString();

  const upsert = await supabaseAdmin
    .from("mobile_push_tokens")
    .upsert(
      {
        user_id: args.userId,
        expo_push_token: token,
        platform: normalizeString(args.payload.platform) ?? "unknown",
        device_name: normalizeString(args.payload.deviceName),
        device_model: normalizeString(args.payload.deviceModel),
        os_name: normalizeString(args.payload.osName),
        os_version: normalizeString(args.payload.osVersion),
        app_version: normalizeString(args.payload.appVersion),
        app_build: normalizeString(args.payload.appBuild),
        app_id: normalizeString(args.payload.appId),
        project_id: normalizeString(args.payload.projectId),
        locale: normalizeString(args.payload.locale),
        is_active: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "expo_push_token" }
    )
    .select("id")
    .maybeSingle();

  if (upsert.error) {
    throw new Error(upsert.error.message ?? "Push token kaydedilemedi.");
  }

  return upsert.data?.id ?? null;
};

export const deactivateMobilePushTokens = async (tokens: string[]) => {
  const validTokens = Array.from(
    new Set(tokens.map((token) => normalizeString(token)).filter((token): token is string => Boolean(token)))
  );

  if (!validTokens.length) {
    return 0;
  }

  const result = await supabaseAdmin
    .from("mobile_push_tokens")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .in("expo_push_token", validTokens);

  if (result.error) {
    throw new Error(result.error.message ?? "Push token pasifleştirilemedi.");
  }

  return validTokens.length;
};

export const loadActiveMobilePushTokens = async (options?: { userId?: string | null }) => {
  let query = supabaseAdmin
    .from("mobile_push_tokens")
    .select("expo_push_token,user_id,platform,device_name,app_version,last_seen_at")
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(5000);

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  const result = await query;
  if (result.error) {
    throw new Error(result.error.message ?? "Push tokenları yüklenemedi.");
  }

  return (result.data ?? []) as Array<{
    expo_push_token: string;
    user_id: string;
    platform: string;
    device_name: string | null;
    app_version: string | null;
    last_seen_at: string;
  }>;
};

export const sendMobilePushNotifications = async (args: SendMobilePushArgs): Promise<SendMobilePushResult> => {
  const tokens = Array.from(
    new Set(args.tokens.map((token) => normalizeString(token)).filter((token): token is string => Boolean(token)))
  ).filter((token) => isExpoPushToken(token));

  if (!tokens.length) {
    return {
      requestedCount: 0,
      successCount: 0,
      failureCount: 0,
      invalidatedTokens: [],
      tickets: [],
    };
  }

  const invalidatedTokens: string[] = [];
  const tickets: Array<Record<string, unknown>> = [];
  let successCount = 0;
  let failureCount = 0;

  for (const tokenChunk of chunk(tokens, EXPO_CHUNK_SIZE)) {
    const messages = tokenChunk.map((token) => ({
      to: token,
      sound: "default",
      title: args.title,
      body: args.body,
      data: {
        ...(args.data ?? {}),
        url: normalizeString(args.deeplinkUrl),
      },
    }));

    const response = await fetch(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
        ...(serverEnv.EXPO_PUSH_ACCESS_TOKEN
          ? {
              Authorization: `Bearer ${serverEnv.EXPO_PUSH_ACCESS_TOKEN}`,
            }
          : {}),
      },
      body: JSON.stringify(messages),
    });

    const body = (await response.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
      errors?: unknown[];
    };

    if (!response.ok) {
      failureCount += tokenChunk.length;
      tickets.push({
        status: "error",
        httpStatus: response.status,
        tokens: tokenChunk,
        errors: body.errors ?? [],
      });
      continue;
    }

    const chunkTickets = Array.isArray(body.data) ? body.data : [];
    for (let index = 0; index < tokenChunk.length; index += 1) {
      const ticket = chunkTickets[index] ?? { status: "error", message: "Expo ticket missing" };
      tickets.push(ticket);

      if (ticket.status === "ok") {
        successCount += 1;
        continue;
      }

      failureCount += 1;
      const details =
        typeof ticket.details === "object" && ticket.details !== null
          ? (ticket.details as Record<string, unknown>)
          : null;
      if (details?.error === "DeviceNotRegistered") {
        invalidatedTokens.push(tokenChunk[index]);
      }
    }
  }

  if (invalidatedTokens.length) {
    await deactivateMobilePushTokens(invalidatedTokens);
  }

  return {
    requestedCount: tokens.length,
    successCount,
    failureCount,
    invalidatedTokens: Array.from(new Set(invalidatedTokens)),
    tickets,
  };
};
