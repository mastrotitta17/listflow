import type { NextRequest } from "next/server";

type RequestLike = Pick<NextRequest, "headers" | "nextUrl">;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const isLocalHost = (hostname: string) => LOCAL_HOSTS.has(hostname.toLowerCase());

const parseCandidateUrl = (value: string | null | undefined) => {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
};

const buildUrlFromRequest = (request: RequestLike, options?: { allowLocalHost?: boolean }) => {
  const allowLocalHost = options?.allowLocalHost ?? false;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const rawProtocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");

  if (!forwardedHost) {
    return null;
  }

  const hostname = forwardedHost.split(":")[0];
  if (!hostname) {
    return null;
  }

  if (!allowLocalHost && isLocalHost(hostname)) {
    return null;
  }

  const protocol = rawProtocol === "http" || rawProtocol === "https" ? rawProtocol : "https";
  return `${protocol}://${forwardedHost}`;
};

export const resolvePublicSiteUrl = (request?: RequestLike) => {
  if (request) {
    const localRequestUrl = buildUrlFromRequest(request, { allowLocalHost: true });
    if (localRequestUrl) {
      try {
        const parsed = new URL(localRequestUrl);
        if (isLocalHost(parsed.hostname)) {
          return stripTrailingSlash(localRequestUrl);
        }
      } catch {
        // ignore invalid request URL and keep resolving
      }
    }
  }

  const envCandidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
  ];

  let firstValidUrl: string | null = null;

  for (const candidate of envCandidates) {
    const parsed = parseCandidateUrl(candidate);
    if (!parsed) {
      continue;
    }

    const normalized = stripTrailingSlash(parsed.toString());

    if (!firstValidUrl) {
      firstValidUrl = normalized;
    }

    if (!isLocalHost(parsed.hostname)) {
      return normalized;
    }
  }

  if (request) {
    const requestUrl = buildUrlFromRequest(request);
    if (requestUrl) {
      return stripTrailingSlash(requestUrl);
    }
  }

  if (firstValidUrl) {
    return firstValidUrl;
  }

  return "https://listflow.pro";
};
