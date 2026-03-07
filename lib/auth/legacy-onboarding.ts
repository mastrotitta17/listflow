import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getAccessTokenFromRequest, getUserFromAccessToken, type AuthUser } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const LEGACY_ONBOARDING_TOKEN_HEADER = "x-legacy-onboarding-token";

export type LegacyOnboardingRequestUser = {
  user: AuthUser;
  authUser: User;
  authMethod: "legacy_token" | "access_token";
  onboardingToken: string | null;
};

const asTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getUserMetadata = (user: User | null | undefined) => {
  if (!user || typeof user.user_metadata !== "object" || user.user_metadata === null) {
    return {} as Record<string, unknown>;
  }

  return user.user_metadata as Record<string, unknown>;
};

const isActiveLegacyOnboardingUser = (user: User, onboardingToken: string) => {
  const metadata = getUserMetadata(user);
  return (
    Boolean(metadata.legacy_onboarding_required) &&
    asTrimmedString(metadata.legacy_onboarding_token) === onboardingToken
  );
};

export const getLegacyOnboardingTokenFromRequest = (request: NextRequest) => {
  const headerToken = asTrimmedString(request.headers.get(LEGACY_ONBOARDING_TOKEN_HEADER));
  if (headerToken) {
    return headerToken;
  }

  const queryToken = asTrimmedString(new URL(request.url).searchParams.get("token"));
  return queryToken || null;
};

export const findLegacyOnboardingUserByToken = async (onboardingToken: string) => {
  const normalizedToken = asTrimmedString(onboardingToken);
  if (!normalizedToken) {
    return null;
  }

  for (let page = 1; page <= 50; page += 1) {
    const result = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }

    const users = result.data?.users ?? [];
    const found = users.find((user) => isActiveLegacyOnboardingUser(user, normalizedToken)) ?? null;
    if (found) {
      return found;
    }

    if (users.length < 200) {
      break;
    }
  }

  return null;
};

export const resolveLegacyOnboardingRequestUser = async (
  request: NextRequest
): Promise<LegacyOnboardingRequestUser | null> => {
  const onboardingToken = getLegacyOnboardingTokenFromRequest(request);
  if (onboardingToken) {
    const authUser = await findLegacyOnboardingUserByToken(onboardingToken);
    if (!authUser) {
      return null;
    }

    return {
      user: {
        id: authUser.id,
        email: authUser.email ?? null,
      },
      authUser,
      authMethod: "legacy_token",
      onboardingToken,
    };
  }

  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    return null;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user) {
    return null;
  }

  const authUserResult = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (authUserResult.error || !authUserResult.data.user) {
    return null;
  }

  return {
    user,
    authUser: authUserResult.data.user,
    authMethod: "access_token",
    onboardingToken: null,
  };
};
