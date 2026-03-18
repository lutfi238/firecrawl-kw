import { useState, useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import type { JsonRpcResponse, ToolCallResult } from "@/types/mcp";
import { useSettings } from "@/hooks/useSettings";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/mcp-server`;

export function useMCPServer() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const githubToken = useAuthStore((s) => s.githubToken);
  const { settings } = useSettings();

  const getHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      apikey: SUPABASE_ANON_KEY,
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    if (githubToken) {
      headers["X-GitHub-Token"] = githubToken;
    }
    if (settings?.mcp_secret) {
      headers["X-MCP-Secret"] = settings.mcp_secret;
    }
    return headers;
  }, [githubToken, settings]);

  const callTool = useCallback(
    async (toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
      setLoading(true);
      setError(null);

      try {
        const body = {
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        };

        const headers = await getHeaders();

        const res = await fetch(MCP_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream")) {
          const text = await res.text();
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed: JsonRpcResponse = JSON.parse(line.slice(6));
                if (parsed.result) {
                  return parsed.result as ToolCallResult;
                }
                if (parsed.error) {
                  throw new Error(parsed.error.message);
                }
              } catch {
                // skip non-JSON lines
              }
            }
          }
          throw new Error("No valid response in SSE stream");
        }

        const data: JsonRpcResponse = await res.json();
        if (data.error) {
          throw new Error(data.error.message);
        }
        return data.result as ToolCallResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[MCP callTool] Error:", message, err);
        setError(message);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      } finally {
        setLoading(false);
      }
    },
    [getHeaders]
  );

  /** Stream a tool call — yields delta strings as they arrive. */
  const callToolStream = useCallback(
    async function* (
      toolName: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ): AsyncGenerator<string, void, unknown> {
      const body = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: { ...args, stream: true } },
      };

      const headers = await getHeaders();
      const res = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "data: [DONE]") return;
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                if (json.error) {
                  yield `Error: ${json.error}`;
                  return;
                }
                if (json.delta) {
                  yield json.delta;
                }
              } catch {
                // skip
              }
            }
          }
        }
      } else {
        // Non-streaming fallback: parse JSON and yield full content
        const data: JsonRpcResponse = await res.json();
        if (data.error) {
          yield `Error: ${data.error.message}`;
          return;
        }
        const result = data.result as ToolCallResult;
        const text = result.content.map(c => c.text ?? "").join("\n");
        yield text;
      }
    },
    [getHeaders]
  );

  const pingServer = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(MCP_ENDPOINT, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { callTool, callToolStream, pingServer, loading, error };
}
