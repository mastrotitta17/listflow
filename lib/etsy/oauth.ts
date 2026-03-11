import { createHash, createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const ETSY_OAUTH_COOKIE = "lf_etsy_oauth";
const ETSY_OAUTH_COOKIE_MAX_AGE = 60 * 10;

export type EtsyOauthCookiePayload = {
  state: string;
  codeVerifier: string;
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
  const explicitSecret = process.env.ETSY_OAUTH_STATE_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const fallbackSecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallbackSecret) {
    return fallbackSecret;
  }

  throw new Error("Missing ETSY_OAUTH_STATE_SECRET and SUPABASE_SERVICE_ROLE_KEY.");
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
  return createHash("sha256").update(verifier).digest("base64url");
};

export const createEtsyOauthCookiePayload = (args: {
  returnTo?: string | null;
}) => {
  return {
    state: base64url(randomBytes(24)),
    codeVerifier: createPkceVerifier(),
    returnTo: normalizeReturnTo(args.returnTo),
    createdAt: Date.now(),
  } satisfies EtsyOauthCookiePayload;
};

export const serializeEtsyOauthCookiePayload = (payload: EtsyOauthCookiePayload) => {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const parseEtsyOauthCookiePayload = (raw: string | null | undefined) => {
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
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<EtsyOauthCookiePayload>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }

    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      returnTo: normalizeReturnTo(parsed.returnTo),
      createdAt: parsed.createdAt,
    } satisfies EtsyOauthCookiePayload;
  } catch {
    return null;
  }
};

export const setEtsyOauthCookie = (response: NextResponse, payload: EtsyOauthCookiePayload) => {
  response.cookies.set(ETSY_OAUTH_COOKIE, serializeEtsyOauthCookiePayload(payload), {
    ...baseCookieOptions,
    maxAge: ETSY_OAUTH_COOKIE_MAX_AGE,
  });
};

export const clearEtsyOauthCookie = (response: NextResponse) => {
  response.cookies.set(ETSY_OAUTH_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });
};
