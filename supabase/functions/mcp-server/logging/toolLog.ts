import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateBearer } from "../auth/oauth.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

const MAX_FIELD_BYTES = 12_000;

interface LogPayload {
  tool: string;
  input: unknown;
  output: unknown;
  status: "success" | "error";
  durationMs: number;
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clamp(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_FIELD_BYTES) {
      return JSON.parse(json);
    }
    return {
      _truncated: true,
      preview: json.slice(0, MAX_FIELD_BYTES),
    };
  } catch {
    return {
      _truncated: true,
      preview: String(value).slice(0, MAX_FIELD_BYTES),
    };
  }
}

function detectSource(req: Request, authHeader: string | null): string {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  const origin = (req.headers.get("origin") || "").toLowerCase();
  const referer = (req.headers.get("referer") || "").toLowerCase();
  const xClientInfo = (req.headers.get("x-client-info") || "").toLowerCase();
  const hasMcpSecret = req.headers.get("x-mcp-secret") !== null;

  if (origin.includes("claude.ai") || referer.includes("claude.ai")) {
    return "claude-web";
  }
  if (
    origin.includes("firecrawl-kw.vercel.app") ||
    origin.includes("lovable.app")
  ) {
    return "dashboard";
  }
  if (
    xClientInfo.includes("supabase") &&
    authHeader?.toLowerCase().startsWith("bearer ")
  ) {
    return "dashboard";
  }
  if (hasMcpSecret) {
    if (ua.includes("zed")) return "zed";
    if (ua.includes("cursor")) return "cursor";
    if (ua.includes("vscode") || ua.includes("vs code")) return "vscode";
    if (ua.includes("claude")) return "claude-desktop";
    if (ua.includes("node") || ua.includes("undici")) return "stdio-proxy";
    return "local-client";
  }
  if (ua.includes("claude")) return "claude-web";
  if (ua.includes("zed")) return "zed";
  if (ua.includes("cursor")) return "cursor";
  if (ua.includes("vscode") || ua.includes("vs code")) return "vscode";
  return "remote-mcp";
}

async function resolveUserId(
  authHeader: string | null,
): Promise<string | null> {
  const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID") || null;
  if (!authHeader) return defaultUserId;

  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (bearer) {
    const oauth = await validateBearer(bearer);
    if (oauth.ok && oauth.user_id) return oauth.user_id;

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    if (url && key) {
      try {
        const sb = createClient(url, key, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data } = await sb.auth.getUser();
        if (data.user?.id) return data.user.id;
      } catch {
        /* ignore */
      }
    }
  }
  return defaultUserId;
}

export async function logToolCall(
  req: Request,
  authHeader: string | null,
  payload: LogPayload,
): Promise<void> {
  try {
    const sb = getServiceClient();
    if (!sb) return;

    const userId = await resolveUserId(authHeader);
    if (!userId) return;

    const source = detectSource(req, authHeader);

    await sb.from("mcp_logs").insert({
      user_id: userId,
      tool: payload.tool,
      input: clamp(payload.input),
      output: clamp(payload.output),
      status: payload.status,
      duration_ms: payload.durationMs,
      source,
    });
  } catch (err) {
    console.warn(
      "[mcp] log insert failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
