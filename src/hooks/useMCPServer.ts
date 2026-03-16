import { useState, useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";
import type { JsonRpcResponse, ToolCallResult } from "@/types/mcp";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/mcp-server`;

export function useMCPServer() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const githubToken = useAuthStore((s) => s.githubToken);

  const callTool = useCallback(
    async (toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
      setLoading(true);
      setError(null);
      const startTime = Date.now();

      try {
        const body = {
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        };
        if (githubToken) {
          headers["X-GitHub-Token"] = githubToken;
        }

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
    [githubToken]
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

  return { callTool, pingServer, loading, error };
}
