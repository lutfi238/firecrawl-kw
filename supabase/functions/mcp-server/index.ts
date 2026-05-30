import { getAiSettingsFromMap } from "./ai/settings.ts";
import { checkMcpAuth, resolveUserId } from "./auth/mcpSecret.ts";
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

// Heuristic: detect when a static scrape returned only an unrendered SPA shell
// (e.g. "Loading...") so we can transparently retry with JS rendering.
function looksLikeSpaShell(text: string): boolean {
  const trimmed = (text || "").trim();

  // Strip markdown headings/links/images to estimate "real" visible text.
  // (A small static page like example.com still has real sentences here, so we
  // must NOT upgrade purely because the raw markdown is short.)
  const visible = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[[^\]]*\]\([^)]*\)/g, "") // links
    .replace(/[#>*_`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Almost nothing rendered -> very likely an unrendered JS page.
  if (visible.length < 50) return true;

  // Explicit loading-shell signatures with little surrounding content.
  // Capped length avoids false positives where "loading" appears in real prose.
  const loadingSignals =
    /\b(loading|please wait|enable javascript|you need to enable javascript)\b/i;
  if (loadingSignals.test(visible) && visible.length < 400) return true;

  return false;
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
      tools: 20,
      oauth: true,
      rest_api: ["/v1/web/fetch", "/v1/search"],
    });
  }

  // ---- REST API endpoints (auth required) ----
  // These mirror the JSON-RPC tools but accept simple JSON bodies.
  // POST /v1/web/fetch  → scrape / scrape_js
  // POST /v1/search     → search
  if (
    req.method === "POST" &&
    (path === "/v1/web/fetch" || path === "/v1/search")
  ) {
    const resourceMetadataUrl = `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;
    const denied = await checkMcpAuth(req, corsHeaders, resourceMetadataUrl);
    if (denied) return denied;

    const restAuthHeader = req.headers.get("authorization") || null;
    const restMcpSecret = req.headers.get("x-mcp-secret") || null;
    const restUserId = await resolveUserId(restAuthHeader, restMcpSecret);

    try {
      const body = await req.json();

      if (path === "/v1/web/fetch") {
        const {
          url,
          format = "markdown",
          max_characters = 0,
        } = body as {
          url?: string;
          format?: string;
          max_characters?: number;
        };
        if (!url) {
          return jsonResponse({ error: "Missing required field: url" }, 400);
        }

        const startedAt = Date.now();
        // JS rendering strategy:
        //   js: true       -> force scrape_js
        //   js: false      -> force static scrape (no auto-upgrade)
        //   js omitted     -> static scrape first, then auto-upgrade to
        //                     scrape_js if the result looks like an unrendered
        //                     SPA shell (e.g. "Loading...").
        const forceJs = body.js === true;
        const allowAutoUpgrade = body.js === undefined || body.js === null;
        let toolName = forceJs ? "scrape_js" : "scrape";
        let outcome = await handleToolCall({
          args: { url, waitFor: body.waitFor || 3000 },
          authHeader: restAuthHeader,
          corsHeaders,
          name: toolName,
          userId: restUserId,
        });

        let autoUpgraded = false;
        if (
          allowAutoUpgrade &&
          outcome.kind === "result" &&
          outcome.result &&
          !outcome.result.isError
        ) {
          const firstPass = outcome.result.content
            .map((c) => (c as { text?: string }).text ?? "")
            .join("\n");
          if (looksLikeSpaShell(firstPass)) {
            autoUpgraded = true;
            toolName = "scrape_js";
            outcome = await handleToolCall({
              args: { url, waitFor: body.waitFor || 6000 },
              authHeader: restAuthHeader,
              corsHeaders,
              name: toolName,
              userId: restUserId,
            });
          }
        }

        if (outcome.kind === "result" && outcome.result) {
          const text = outcome.result.content
            .map((c) => (c as { text?: string }).text ?? "")
            .join("\n");

          // Apply max_characters truncation
          const truncated =
            max_characters > 0 && text.length > max_characters
              ? text.slice(0, max_characters)
              : text;

          await logToolCall(req, restAuthHeader, {
            tool: toolName,
            input: { url, format, max_characters },
            output: {
              truncated: max_characters > 0 && text.length > max_characters,
              length: truncated.length,
            },
            status: outcome.result.isError ? "error" : "success",
            durationMs: Date.now() - startedAt,
          });

          if (outcome.result.isError) {
            return jsonResponse({ success: false, error: truncated }, 422);
          }

          const response: Record<string, unknown> = {
            success: true,
            data: {
              url,
              format,
              markdown: format === "markdown" ? truncated : undefined,
              html: format === "html" ? truncated : undefined,
              content: truncated,
              metadata: {
                contentLength: truncated.length,
                truncated: max_characters > 0 && text.length > max_characters,
                jsRendered: toolName === "scrape_js",
                autoUpgraded,
              },
            },
          };
          return jsonResponse(response);
        }

        return jsonResponse({ success: false, error: "Scrape failed" }, 500);
      }

      if (path === "/v1/search") {
        const {
          query,
          search_type = "web",
          max_results = 5,
        } = body as {
          query?: string;
          search_type?: string;
          max_results?: number;
        };
        if (!query) {
          return jsonResponse({ error: "Missing required field: query" }, 400);
        }

        const startedAt = Date.now();
        const outcome = await handleToolCall({
          args: { query, maxResults: max_results },
          authHeader: restAuthHeader,
          corsHeaders,
          name: "search",
          userId: restUserId,
        });

        if (outcome.kind === "result" && outcome.result) {
          const text = outcome.result.content
            .map((c) => (c as { text?: string }).text ?? "")
            .join("\n");

          await logToolCall(req, restAuthHeader, {
            tool: "search",
            input: { query, search_type, max_results },
            output: { length: text.length },
            status: outcome.result.isError ? "error" : "success",
            durationMs: Date.now() - startedAt,
          });

          if (outcome.result.isError) {
            return jsonResponse({ success: false, error: text }, 422);
          }

          // Parse the search results JSON
          let results: unknown[] = [];
          try {
            results = JSON.parse(text);
          } catch {
            results = [{ title: "Raw results", url: "", snippet: text }];
          }

          return jsonResponse({
            success: true,
            data: {
              query,
              search_type,
              results,
              count: Array.isArray(results) ? results.length : 0,
            },
          });
        }

        return jsonResponse({ success: false, error: "Search failed" }, 500);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      console.error("REST API error:", message);
      return jsonResponse({ success: false, error: message }, 500);
    }
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ---- MCP JSON-RPC (auth required) ----
  const resourceMetadataUrl = `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;
  const denied = await checkMcpAuth(req, corsHeaders, resourceMetadataUrl);
  if (denied) return denied;

  const authHeader = req.headers.get("authorization") || null;
  const mcpSecretHeader = req.headers.get("x-mcp-secret") || null;
  const userId = await resolveUserId(authHeader, mcpSecretHeader);

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
        userId,
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
