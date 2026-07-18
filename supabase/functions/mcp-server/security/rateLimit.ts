declare const Deno: {
  env: { get(key: string): string | undefined };
};

export interface RateLimitEnvironment {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  degraded: boolean;
}

interface ConsumeRateLimitOptions {
  scope: string;
  identity: string;
  maxRequests: number;
  windowSeconds: number;
  environment?: RateLimitEnvironment;
  fetchImpl?: typeof fetch;
}

interface RpcDecision {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    forwarded ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function getRateLimitMaximum(envName: string, fallback: number): number {
  const configured = Number(Deno.env.get(envName));
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

function getEnvironment(): RateLimitEnvironment | undefined {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : undefined;
}

export async function consumeRateLimit({
  scope,
  identity,
  maxRequests,
  windowSeconds,
  environment = getEnvironment(),
  fetchImpl = fetch,
}: ConsumeRateLimitOptions): Promise<RateLimitDecision> {
  const fallback: RateLimitDecision = {
    allowed: true,
    remaining: maxRequests,
    retryAfterSeconds: windowSeconds,
    degraded: true,
  };

  if (!environment) {
    console.warn("[rate-limit] backing service is not configured; allowing request");
    return fallback;
  }

  try {
    const response = await fetchImpl(
      `${environment.supabaseUrl}/rest/v1/rpc/consume_mcp_rate_limit`,
      {
        method: "POST",
        headers: {
          apikey: environment.serviceRoleKey,
          Authorization: `Bearer ${environment.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_bucket_key: `${scope}:${identity}`,
          p_window_seconds: windowSeconds,
          p_max_requests: maxRequests,
        }),
      },
    );

    if (!response.ok) {
      console.warn(`[rate-limit] RPC unavailable (${response.status}); allowing request`);
      return fallback;
    }

    const payload = (await response.json()) as RpcDecision[] | RpcDecision;
    const result = Array.isArray(payload) ? payload[0] : payload;
    if (!result || typeof result.allowed !== "boolean") {
      console.warn("[rate-limit] RPC returned an invalid response; allowing request");
      return fallback;
    }

    return {
      allowed: result.allowed,
      remaining: Math.max(0, Number(result.remaining) || 0),
      retryAfterSeconds: Math.max(1, Number(result.retry_after_seconds) || 1),
      degraded: false,
    };
  } catch {
    console.warn("[rate-limit] RPC request failed; allowing request");
    return fallback;
  }
}

export function rateLimitResponse(
  decision: RateLimitDecision,
  corsHeaders: Record<string, string>,
): Response | null {
  if (decision.allowed) return null;

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32029, message: "Rate limit exceeded" },
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(decision.retryAfterSeconds),
        "X-RateLimit-Remaining": String(decision.remaining),
      },
    },
  );
}
