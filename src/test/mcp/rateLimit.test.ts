import { describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  getClientIp,
  rateLimitResponse,
} from "../../../supabase/functions/mcp-server/security/rateLimit";

const environment = {
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: "service-role",
};

describe("MCP rate limiting", () => {
  it("returns the remaining quota from the atomic RPC", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ allowed: true, remaining: 119, retry_after_seconds: 60 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const decision = await consumeRateLimit({
      scope: "mcp",
      identity: "user:abc",
      maxRequests: 120,
      windowSeconds: 60,
      environment,
      fetchImpl,
    });

    expect(decision).toEqual({
      allowed: true,
      remaining: 119,
      retryAfterSeconds: 60,
      degraded: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/consume_mcp_rate_limit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_bucket_key: "mcp:user:abc",
          p_window_seconds: 60,
          p_max_requests: 120,
        }),
      }),
    );
  });

  it("builds a 429 response with retry metadata when the quota is exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ allowed: false, remaining: 0, retry_after_seconds: 17 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const decision = await consumeRateLimit({
      scope: "oauth",
      identity: "ip:203.0.113.10",
      maxRequests: 30,
      windowSeconds: 60,
      environment,
      fetchImpl,
    });
    const response = rateLimitResponse(decision, { "Access-Control-Allow-Origin": "*" });

    expect(decision.allowed).toBe(false);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("17");
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: -32029, message: "Rate limit exceeded" },
    });
  });

  it("fails open without exposing configuration when the RPC is unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      consumeRateLimit({
        scope: "mcp",
        identity: "user:abc",
        maxRequests: 120,
        windowSeconds: 60,
        environment,
        fetchImpl,
      }),
    ).resolves.toEqual({
      allowed: true,
      remaining: 120,
      retryAfterSeconds: 60,
      degraded: true,
    });
  });

  it("uses the first forwarded address and falls back when no client IP exists", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }))).toBe("203.0.113.10");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
