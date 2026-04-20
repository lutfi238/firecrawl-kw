import { getAiSettingsFromMap } from "./ai/settings.ts";
import { checkMcpSecret } from "./auth/mcpSecret.ts";
import { getUserSettings } from "./auth/userSettings.ts";
import { getToolDefinitions } from "./tools/definitions.ts";
import { handleToolCall } from "./tools/callTool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-github-token, x-mcp-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
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

  if (req.method === "GET") {
    return jsonResponse({ status: "ok", server: "personal-firecrawl", version: "2.0.0", tools: 15 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const denied = checkMcpSecret(req, corsHeaders);
  if (denied) return denied;

  const authHeader = req.headers.get("authorization") || null;

  try {
    const body = await req.json();
    const { id, method, params } = body;

    if (method === "initialize") {
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "personal-firecrawl", version: "2.0.0" },
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
      const outcome = await handleToolCall({ args, authHeader, corsHeaders, name });

      if (outcome.kind === "response") {
        return outcome.response;
      }

      if (outcome.kind === "unknown-tool") {
        return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      }

      return jsonResponse({ jsonrpc: "2.0", id, result: outcome.result });
    }

    return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("MCP error:", message);
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32603, message } });
  }
});
