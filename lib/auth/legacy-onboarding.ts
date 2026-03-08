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

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("legacy_onboarding_tokens");
};

const throwMissingLegacyOnboardingTableError = () => {
  throw new Error(
    "legacy_onboarding_tokens tablosu bulunamadı. Legacy onboarding bağlantılarının çalışması için son Supabase migration'larını uygulayın."
  );
};

const isActiveLegacyOnboardingUser = (user: User, onboardingToken: string) => {
  const metadata = getUserMetadata(user);
  return (
    Boolean(metadata.legacy_onboarding_required) &&
    asTrimmedString(metadata.legacy_onboarding_token) === onboardingToken
  );
};

type LegacyOnboardingTokenRow = {
  token: string;
  user_id: string;
  email?: string | null;
  consumed_at?: string | null;
  created_at?: string | null;
};

const findLegacyOnboardingTokenRow = async (onboardingToken: string) => {
  const result = await supabaseAdmin
    .from("legacy_onboarding_tokens")
    .select("token,user_id,email,consumed_at,created_at")
    .eq("token", onboardingToken)
    .maybeSingle<LegacyOnboardingTokenRow>();

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return { row: null as LegacyOnboardingTokenRow | null, missingRelation: true };
    }
    throw new Error(result.error.message);
  }

  return { row: result.data ?? null, missingRelation: false };
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

  const tokenLookup = await findLegacyOnboardingTokenRow(normalizedToken);
  if (tokenLookup.row) {
    if (tokenLookup.row.consumed_at) {
      return null;
    }

    const authUserResult = await supabaseAdmin.auth.admin.getUserById(tokenLookup.row.user_id);
    if (authUserResult.error || !authUserResult.data.user) {
      return null;
    }

    return authUserResult.data.user;
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

export const invalidateLegacyOnboardingTokensForUser = async (userId: string) => {
  const nowIso = new Date().toISOString();
  const result = await supabaseAdmin
    .from("legacy_onboarding_tokens")
    .update({ consumed_at: nowIso })
    .eq("user_id", userId)
    .is("consumed_at", null);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      throwMissingLegacyOnboardingTableError();
    }
    throw new Error(result.error.message);
  }
};

export const createLegacyOnboardingTokenRecord = async (args: {
  token: string;
  userId: string;
  email: string | null;
  createdBy: string | null;
}) => {
  const result = await supabaseAdmin.from("legacy_onboarding_tokens").insert({
    token: args.token,
    user_id: args.userId,
    email: args.email,
    created_by: args.createdBy,
  });

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      throwMissingLegacyOnboardingTableError();
    }
    throw new Error(result.error.message);
  }
};

export const consumeLegacyOnboardingToken = async (token: string | null | undefined) => {
  const normalizedToken = asTrimmedString(token);
  if (!normalizedToken) {
    return;
  }

  const result = await supabaseAdmin
    .from("legacy_onboarding_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", normalizedToken)
    .is("consumed_at", null);

  if (result.error && !isMissingRelationError(result.error)) {
    throw new Error(result.error.message);
  }
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
