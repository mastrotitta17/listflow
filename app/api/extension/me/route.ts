import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { buildExtensionStateSnapshot } from "@/lib/extension/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.replace("Bearer ", "").trim();
  return token || null;
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

    const state = await buildExtensionStateSnapshot({
      userId: user.id,
      email: user.email ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        state,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load extension profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
