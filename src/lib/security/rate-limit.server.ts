type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function resetMemoryRateLimits() {
  buckets.clear();
}

export function clientAddress(request: Request) {
  if (process.env["RATE_LIMIT_TRUST_CF"] !== "true") return "unknown";
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export async function rateLimitResponse(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
  const key = `${scope}:${clientAddress(request)}`;
  const shared = await consumeSharedRateLimit(key, limit, windowMs);
  if (shared) return shared;
  return memoryRateLimit(key, limit, windowMs);
}

function memoryRateLimit(key: string, limit: number, windowMs: number): Response | null {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return denied(retryAfter);
}

async function consumeSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<Response | null | undefined> {
  if (process.env["RATE_LIMIT_STORE"] === "memory") return undefined;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error || !data?.[0]) return undefined;
    const row = data[0];
    if (row.allowed) return null;
    return denied(row.retry_after_seconds);
  } catch {
    return undefined;
  }
}

export async function throwIfRateLimited(key: string, limit: number, windowMs: number) {
  const shared = await consumeSharedRateLimit(key, limit, windowMs);
  if (shared) throw new Error("Too many requests. Try again shortly.");
  if (shared === undefined && memoryRateLimit(key, limit, windowMs)) {
    throw new Error("Too many requests. Try again shortly.");
  }
}

function denied(retryAfter: number) {
  return Response.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
