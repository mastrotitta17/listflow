import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_FETCH_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const toHttpUrl = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const jsonError = (error: string, status: number) =>
  NextResponse.json(
    { ok: false, error },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    }
  );

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetUrl = toHttpUrl(body?.url);

    if (!targetUrl) {
      return jsonError("invalid image url", 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(targetUrl.toString(), {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return jsonError(`request_timeout_${IMAGE_FETCH_TIMEOUT_MS}ms`, 504);
      }
      const message = error instanceof Error ? error.message : "image fetch failed";
      return jsonError(message, 502);
    } finally {
      clearTimeout(timer);
    }

    if (!upstreamResponse.ok) {
      return jsonError(`image fetch failed (${upstreamResponse.status})`, 502);
    }

    const contentLength = Number(upstreamResponse.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return jsonError(`image too large (${contentLength} bytes)`, 413);
    }

    const mimeHeader = upstreamResponse.headers.get("content-type") ?? "image/jpeg";
    const mime = mimeHeader.split(";")[0]?.trim() || "image/jpeg";

    const arrayBuffer = await upstreamResponse.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      return jsonError("empty image payload", 502);
    }

    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return jsonError(`image too large (${arrayBuffer.byteLength} bytes)`, 413);
    }

    return NextResponse.json(
      {
        ok: true,
        mime,
        base64: Buffer.from(arrayBuffer).toString("base64"),
        size: arrayBuffer.byteLength,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "image conversion failed";
    return jsonError(message, 500);
  }
}
