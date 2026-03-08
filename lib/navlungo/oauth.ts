import { createHash, createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NavlungoEnvironment } from "@/lib/navlungo/config";

export const NAVLUNGO_OAUTH_COOKIE = "lf_navlungo_oauth";
const NAVLUNGO_OAUTH_COOKIE_MAX_AGE = 60 * 10;

export type NavlungoOauthCookiePayload = {
  state: string;
  codeVerifier: string;
  environment: NavlungoEnvironment;
  returnTo: string;
  createdAt: number;
};

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

const readSigningSecret = () => {
  const explicitSecret = process.env.NAVLUNGO_OAUTH_STATE_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const fallbackSecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallbackSecret) {
    return fallbackSecret;
  }

  throw new Error("Missing NAVLUNGO_OAUTH_STATE_SECRET and SUPABASE_SERVICE_ROLE_KEY.");
};

const signPayload = (payload: string) => {
  return createHmac("sha256", readSigningSecret()).update(payload).digest("base64url");
};

const normalizeReturnTo = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/admin";
  }

  return trimmed;
};

export const createPkceVerifier = () => base64url(randomBytes(48));

export const createPkceChallenge = (verifier: string) => {
  return createHash("sha256").update(verifier).digest("base64");
};

export const createNavlungoOauthCookiePayload = (args: {
  environment: NavlungoEnvironment;
  returnTo?: string | null;
}) => {
  return {
    state: base64url(randomBytes(24)),
    codeVerifier: createPkceVerifier(),
    environment: args.environment,
    returnTo: normalizeReturnTo(args.returnTo),
    createdAt: Date.now(),
  } satisfies NavlungoOauthCookiePayload;
};

export const serializeNavlungoOauthCookiePayload = (payload: NavlungoOauthCookiePayload) => {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const parseNavlungoOauthCookiePayload = (raw: string | null | undefined) => {
  if (!raw) {
    return null;
  }

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (expectedSignature !== signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<NavlungoOauthCookiePayload>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.environment !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }

    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      environment: parsed.environment === "prod" ? "prod" : "qa",
      returnTo: normalizeReturnTo(parsed.returnTo),
      createdAt: parsed.createdAt,
    } satisfies NavlungoOauthCookiePayload;
  } catch {
    return null;
  }
};

export const setNavlungoOauthCookie = (response: NextResponse, payload: NavlungoOauthCookiePayload) => {
  response.cookies.set(NAVLUNGO_OAUTH_COOKIE, serializeNavlungoOauthCookiePayload(payload), {
    ...baseCookieOptions,
    maxAge: NAVLUNGO_OAUTH_COOKIE_MAX_AGE,
  });
};

export const clearNavlungoOauthCookie = (response: NextResponse) => {
  response.cookies.set(NAVLUNGO_OAUTH_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });
};
