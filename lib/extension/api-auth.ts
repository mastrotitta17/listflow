import type { NextRequest } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";

export const readExtensionAccessToken = (request: NextRequest) => {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.replace("Bearer ", "").trim();
  return token || null;
};

export const resolveExtensionUser = async (request: NextRequest) => {
  const accessToken = readExtensionAccessToken(request);
  if (!accessToken) {
    return null;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user) {
    return null;
  }

  return {
    accessToken,
    user,
  };
};
