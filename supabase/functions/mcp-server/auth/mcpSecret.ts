import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateBearer } from "./oauth.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

type SecretRequest = Pick<Request, "headers">;

/**
 * Validates MCP requests. Accepts EITHER:
 *   - X-MCP-Secret header matching MCP_SECRET env var (legacy clients), OR
 *   - Authorization: Bearer <token> issued via OAuth flow (Claude Web etc.), OR
 *   - Authorization: Bearer <supabase-session-token> for the authenticated dashboard.
 *
 * Returns null when authorized, or a 401 Response when not.
 */
export async function checkMcpAuth(
  request: SecretRequest,
  corsHeaders: Record<string, string>,
  resourceMetadataUrl: string,
): Promise<Response | null> {
  const secret = Deno.env.get("MCP_SECRET");
  const provided = request.headers.get("x-mcp-secret");

  if (provided) {
    if (secret && provided === secret) {
      console.log("[mcp] auth secret ok");
      return null;
    }
    console.warn("[mcp] auth secret mismatch");
    return unauthorized(
      corsHeaders,
      resourceMetadataUrl,
      "invalid X-MCP-Secret",
    );
  }

  const authz = request.headers.get("authorization") || "";
  if (authz.toLowerCase().startsWith("bearer ")) {
    const token = authz.slice(7).trim();
    const result = await validateBearer(token);
    if (result.ok) {
      console.log("[mcp] auth oauth bearer ok client_id=", result.client_id);
      return null;
    }

    const supabaseUserId = await validateSupabaseSession(token);
    if (supabaseUserId) {
      console.log("[mcp] auth supabase bearer ok user_id=", supabaseUserId);
      return null;
    }

    console.warn("[mcp] auth bearer invalid");
    return unauthorized(
      corsHeaders,
      resourceMetadataUrl,
      "invalid bearer token",
    );
  }

  // No credentials supplied at all. If neither MCP_SECRET nor OAuth is needed (no secret env)
  // and bearer absent, we still require auth — production posture.
  if (!secret) {
    // If you intentionally want a fully open server, set MCP_SECRET to empty AND remove this guard.
    // We require OAuth in that case.
  }
  console.warn("[mcp] auth missing");
  return unauthorized(
    corsHeaders,
    resourceMetadataUrl,
    "authentication required",
  );
}

async function validateSupabaseSession(token: string): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key || !token) return null;

  try {
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function unauthorized(
  corsHeaders: Record<string, string>,
  resourceMetadataUrl: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: `Unauthorized: ${message}` },
    }),
    {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${resourceMetadataUrl}"`,
      },
    },
  );
}

// Backwards compat name (in case anything still imports it).
export const checkMcpSecret = checkMcpAuth;
