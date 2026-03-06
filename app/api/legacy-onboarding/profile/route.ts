import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { normalizePhoneForStorage } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) {
      return token;
    }
  }

  return request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
};

type LegacyProfileBody = {
  fullName?: unknown;
  phone?: unknown;
  password?: unknown;
};

type ProfileRow = {
  full_name?: string | null;
  phone?: string | null;
};

const normalizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const loadProfileWithFallback = async (userId: string) => {
  const selectCandidates = ["full_name,phone", "full_name"] as const;
  let fullName: string | null = null;
  let phone: string | null = null;

  for (const select of selectCandidates) {
    const profileQuery = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();

    if (!profileQuery.error) {
      fullName = typeof profileQuery.data?.full_name === "string" ? profileQuery.data.full_name : null;
      phone = typeof profileQuery.data?.phone === "string" ? profileQuery.data.phone : null;
      break;
    }

    if (!isMissingColumnError(profileQuery.error, "phone")) {
      throw new Error(profileQuery.error.message);
    }
  }

  return { fullName, phone };
};

const upsertProfile = async (args: {
  userId: string;
  email: string | null;
  fullName: string;
  phone: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      email: args.email,
      full_name: args.fullName,
      phone: args.phone,
      updated_at: nowIso,
    },
    {
      user_id: args.userId,
      email: args.email,
      full_name: args.fullName,
      phone: args.phone,
    },
    {
      user_id: args.userId,
      email: args.email,
      full_name: args.fullName,
      updated_at: nowIso,
    },
    {
      user_id: args.userId,
      email: args.email,
      full_name: args.fullName,
    },
  ];

  let lastError: { message?: string } | null = null;

  for (const payload of payloads) {
    const result = await supabaseAdmin.from("profiles").upsert(payload, { onConflict: "user_id" });
    if (!result.error) {
      return;
    }

    lastError = result.error;
    if (
      !isMissingColumnError(result.error, "phone") &&
      !isMissingColumnError(result.error, "updated_at")
    ) {
      throw new Error(result.error.message);
    }
  }

  throw new Error(lastError?.message ?? "Profile could not be updated");
};

export async function GET(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUserResult = await supabaseAdmin.auth.admin.getUserById(user.id);
    if (authUserResult.error || !authUserResult.data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = authUserResult.data.user;
    const metadata =
      typeof authUser.user_metadata === "object" && authUser.user_metadata !== null
        ? (authUser.user_metadata as Record<string, unknown>)
        : {};
    const profile = await loadProfileWithFallback(authUser.id);
    const metadataFullName = typeof metadata.full_name === "string" ? metadata.full_name : null;
    const metadataPhone = typeof metadata.phone === "string" ? metadata.phone : null;

    return NextResponse.json({
      success: true,
      user: {
        id: authUser.id,
        email: authUser.email ?? null,
        fullName: metadataFullName ?? profile.fullName ?? null,
        phone: metadataPhone ?? profile.phone ?? null,
        legacyOnboardingRequired: Boolean(metadata.legacy_onboarding_required),
        legacyPasswordSet: Boolean(metadata.legacy_password_set),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy profile load failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const body = (await request.json().catch(() => ({}))) as LegacyProfileBody;
    const fullName = normalizeText(body.fullName, 120);
    const phone = normalizePhoneForStorage(body.phone, 32);
    const passwordRaw = typeof body.password === "string" ? body.password : "";
    const password = passwordRaw.trim();

    if (!fullName) {
      return NextResponse.json({ error: "Ad Soyad zorunludur." }, { status: 400 });
    }

    if (password && password.length < 8) {
      return NextResponse.json({ error: "Şifre en az 8 karakter olmalı." }, { status: 400 });
    }

    const authUserResult = await supabaseAdmin.auth.admin.getUserById(user.id);
    if (authUserResult.error || !authUserResult.data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = authUserResult.data.user;
    const currentMetadata =
      typeof authUser.user_metadata === "object" && authUser.user_metadata !== null
        ? (authUser.user_metadata as Record<string, unknown>)
        : {};

    const updatePayload: {
      password?: string;
      email_confirm?: boolean;
      user_metadata?: Record<string, unknown>;
    } = {
      email_confirm: true,
      user_metadata: {
        ...currentMetadata,
        full_name: fullName,
        display_name: fullName,
        phone: phone ?? null,
        legacy_password_set: password ? true : Boolean(currentMetadata.legacy_password_set),
      },
    };

    if (password) {
      updatePayload.password = password;
    }

    const updated = await supabaseAdmin.auth.admin.updateUserById(user.id, updatePayload);
    if (updated.error) {
      return NextResponse.json({ error: updated.error.message }, { status: 500 });
    }

    await upsertProfile({
      userId: user.id,
      email: authUser.email ?? null,
      fullName,
      phone: phone ?? null,
    });

    return NextResponse.json({
      success: true,
      profile: {
        userId: user.id,
        email: authUser.email ?? null,
        fullName,
        phone: phone ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy profile update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
