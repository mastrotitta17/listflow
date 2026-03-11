export type N8nPayload = {
  client_id: string;
  store_id?: string;
  webhook_config_id?: string | null;
  trigger_type?: string | null;
  subscription_id?: string | null;
  idempotency_key?: string | null;
  slot_due_at?: string | null;
  attempt?: number | null;
  triggered_at?: string | null;
  store_category?: string | null;
  store_currency?: string | null;
  product_id?: string | null;
  user_id?: string | null;
  plan?: string | null;
  source?: string | null;
};

export const buildN8nTriggerPayload = (payload: N8nPayload): N8nPayload => {
  const clientId = String(payload.client_id || "").trim();
  if (!clientId) {
    throw new Error("N8N payload requires client_id.");
  }

  return {
    client_id: clientId,
    store_id: String(payload.store_id || clientId).trim(),
    webhook_config_id: typeof payload.webhook_config_id === "string" ? payload.webhook_config_id.trim() || null : null,
    trigger_type: typeof payload.trigger_type === "string" ? payload.trigger_type.trim() || null : null,
    subscription_id: typeof payload.subscription_id === "string" ? payload.subscription_id.trim() || null : null,
    idempotency_key: typeof payload.idempotency_key === "string" ? payload.idempotency_key.trim() || null : null,
    slot_due_at: typeof payload.slot_due_at === "string" ? payload.slot_due_at.trim() || null : null,
    attempt: Number.isFinite(payload.attempt) ? Number(payload.attempt) : null,
    triggered_at: typeof payload.triggered_at === "string" ? payload.triggered_at.trim() || null : null,
    store_category: typeof payload.store_category === "string" ? payload.store_category.trim() || null : null,
    store_currency: typeof payload.store_currency === "string" ? payload.store_currency.trim() || null : null,
    product_id: typeof payload.product_id === "string" ? payload.product_id.trim() || null : null,
    user_id: typeof payload.user_id === "string" ? payload.user_id.trim() || null : null,
    plan: typeof payload.plan === "string" ? payload.plan.trim() || null : null,
    source: typeof payload.source === "string" ? payload.source.trim() || null : null,
  };
};

type DispatchN8nTriggerInput = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, unknown>;
  payload: N8nPayload;
  idempotencyKey: string;
  triggeredAt: string;
};

const normalizeHeaders = (headers: Record<string, unknown> | undefined) => {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!key) {
      continue;
    }

    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = String(value);
    }
  }

  return normalized;
};

export const dispatchN8nTrigger = async ({
  url,
  method = "POST",
  headers,
  payload,
  idempotencyKey,
  triggeredAt,
}: DispatchN8nTriggerInput) => {
  const targetUrl = url.trim();
  if (!targetUrl) {
    throw new Error("Webhook target URL is required.");
  }

  const body = JSON.stringify(buildN8nTriggerPayload(payload));
  const safeHeaders = normalizeHeaders(headers);
  const finalMethod = method.toUpperCase() === "GET" ? "GET" : "POST";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: finalMethod,
      headers: {
        ...(finalMethod === "POST" ? { "Content-Type": "application/json" } : {}),
        ...safeHeaders,
        "x-listflow-idempotency-key": idempotencyKey,
        "x-listflow-triggered-at": triggeredAt,
      },
      body: finalMethod === "POST" ? body : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body: text,
    url: targetUrl,
    method: finalMethod,
  };
};
