type SecretRequest = Pick<Request, "headers">;

export function checkMcpSecret(request: SecretRequest, corsHeaders: Record<string, string>): Response | null {
  const secret = Deno.env.get("MCP_SECRET");
  if (!secret) return null;
  const provided = request.headers.get("x-mcp-secret");
  if (provided !== secret) {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: invalid or missing X-MCP-Secret header" } }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  return null;
}