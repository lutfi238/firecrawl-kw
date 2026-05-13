import { getAiSettingsFromMap } from "./ai/settings.ts";
import { checkMcpAuth } from "./auth/mcpSecret.ts";
import { getUserSettings } from "./auth/userSettings.ts";
import { logToolCall } from "./logging/toolLog.ts";
import { getToolDefinitions } from "./tools/definitions.ts";
import { handleToolCall } from "./tools/callTool.ts";
import {
  getBaseUrl,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleRegister,
  handleToken,
  oauthAuthorizationServer,
  oauthProtectedResource,
} from "./auth/oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-github-token, x-mcp-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Edge Function paths arrive as e.g. /mcp-server/.well-known/... -- normalize to suffix only.
  const path = url.pathname
    .replace(/^\/functions\/v1\/mcp-server/, "")
    .replace(/^\/mcp-server/, "");

  // ---- OAuth discovery & endpoints (no auth required) ----
  const protectedResourcePaths = new Set([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/",
    "/.well-known/oauth-protected-resource/functions/v1/mcp-server",
    "/.well-known/oauth-protected-resource/functions/v1/mcp-server/",
  ]);
  const authorizationServerPaths = new Set([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/",
    "/.well-known/oauth-authorization-server/functions/v1/mcp-server",
    "/.well-known/oauth-authorization-server/functions/v1/mcp-server/",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/",
    "/.well-known/openid-configuration/functions/v1/mcp-server",
    "/.well-known/openid-configuration/functions/v1/mcp-server/",
  ]);

  if (req.method === "GET" && protectedResourcePaths.has(path)) {
    return oauthProtectedResource(req, corsHeaders);
  }
  if (req.method === "GET" && authorizationServerPaths.has(path)) {
    return oauthAuthorizationServer(req, corsHeaders);
  }
  if (req.method === "POST" && path === "/register") {
    return handleRegister(req, corsHeaders);
  }
  if (path === "/authorize") {
    if (req.method === "GET") return handleAuthorizeGet(req, corsHeaders);
    if (req.method === "POST") return handleAuthorizePost(req, corsHeaders);
  }
  if (req.method === "POST" && path === "/token") {
    return handleToken(req, corsHeaders);
  }

  // ---- Health / status (no auth) ----
  if (req.method === "GET" && (path === "" || path === "/")) {
    return jsonResponse({
      status: "ok",
      server: "personal-firecrawl",
      version: "2.1.0",
      tools: 17,
      oauth: true,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ---- MCP JSON-RPC (auth required) ----
  const resourceMetadataUrl = `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;
  const denied = await checkMcpAuth(req, corsHeaders, resourceMetadataUrl);
  if (denied) return denied;

  const authHeader = req.headers.get("authorization") || null;

  try {
    const body = await req.json();
    const { id, method, params } = body;

    if (method === "initialize") {
      console.log("[mcp] initialize id=", id);
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "personal-firecrawl", version: "2.1.0" },
        },
      });
    }

    if (method === "tools/list") {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      const toolDefs = getToolDefinitions(userSettings, aiSettings);
      return jsonResponse({ jsonrpc: "2.0", id, result: { tools: toolDefs } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      console.log("[mcp] tools/call name=", name);
      const startedAt = Date.now();
      const outcome = await handleToolCall({
        args,
        authHeader,
        corsHeaders,
        name,
      });

      if (outcome.kind === "response") {
        await logToolCall(req, authHeader, {
          tool: name,
          input: args,
          output: { type: "raw-response" },
          status: "success",
          durationMs: Date.now() - startedAt,
        });
        return outcome.response;
      }

      if (outcome.kind === "unknown-tool") {
        await logToolCall(req, authHeader, {
          tool: name,
          input: args,
          output: { error: `Unknown tool: ${name}` },
          status: "error",
          durationMs: Date.now() - startedAt,
        });
        return jsonResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }

      await logToolCall(req, authHeader, {
        tool: name,
        input: args,
        output: outcome.result,
        status: outcome.result?.isError ? "error" : "success",
        durationMs: Date.now() - startedAt,
      });

      return jsonResponse({ jsonrpc: "2.0", id, result: outcome.result });
    }

    return jsonResponse({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("MCP error:", message);
    return jsonResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message },
    });
  }
});
