import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, clearSessionCookies } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResetPasswordBody = {
  password?: unknown;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const normalizePassword = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = await getUserFromAccessToken(accessToken);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as ResetPasswordBody;
    const password = normalizePassword(body.password);

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const updated = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password,
    });

    if (updated.error) {
      return NextResponse.json({ error: updated.error.message }, { status: 400 });
    }

    const response = NextResponse.json({ success: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
