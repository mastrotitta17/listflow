import { NextRequest } from "next/server";
import { POST as handlePortalPost } from "../portal/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handlePortalPost(request);
}
