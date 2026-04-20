import type { Context } from "hono";

export function checkMcpSecret(c: Context, corsHeaders: Record<string, string>): Response | null {
  const secret = Deno.env.get("MCP_SECRET");
  if (!secret) return null;
  const provided = c.req.header("x-mcp-secret");
  if (provided !== secret) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: invalid or missing X-MCP-Secret header" } },
      401,
      corsHeaders
    );
  }
  return null;
}