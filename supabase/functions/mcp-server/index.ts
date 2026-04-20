import { Hono } from "hono";
import { getAiSettingsFromMap } from "./ai/settings.ts";
import { checkMcpSecret } from "./auth/mcpSecret.ts";
import { getUserSettings } from "./auth/userSettings.ts";
import { getToolDefinitions } from "./tools/definitions.ts";
import { handleToolCall } from "./tools/callTool.ts";


// ========== Hono App ==========
const app = new Hono();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-github-token, x-mcp-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

// CORS preflight
app.options("/*", (c) => {
  return new Response(null, { headers: corsHeaders });
});

// Health check GET handler
app.get("/*", (c) => {
  return c.json(
    { status: "ok", server: "personal-firecrawl", version: "2.0.0", tools: 15 },
    200,
    corsHeaders
  );
});

// MCP POST handler
app.post("/*", async (c) => {
  const denied = checkMcpSecret(c, corsHeaders);
  if (denied) return denied;

  const authHeader = c.req.header("authorization") || null;

  try {
    const body = await c.req.json();
    const { id, method, params } = body;

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "personal-firecrawl", version: "2.0.0" },
        },
      }, 200, corsHeaders);
    }

    if (method === "tools/list") {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      const toolDefs = getToolDefinitions(userSettings, aiSettings);
      return c.json({ jsonrpc: "2.0", id, result: { tools: toolDefs } }, 200, corsHeaders);
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const outcome = await handleToolCall({ args, authHeader, corsHeaders, name });
      if (outcome.kind === "response") {
        return outcome.response;
      }
      if (outcome.kind === "unknown-tool") {
        return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } }, 200, corsHeaders);
      }

      const result = outcome.result;

      return c.json({ jsonrpc: "2.0", id, result }, 200, corsHeaders);
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } }, 200, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("MCP error:", message);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }, 200, corsHeaders);
  }
});

Deno.serve(app.fetch);
