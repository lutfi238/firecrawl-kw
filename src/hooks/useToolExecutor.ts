import { useState } from "react";
import { useMCPServer } from "./useMCPServer";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import type { ToolCallResult } from "@/types/mcp";

export function useToolExecutor() {
  const { callTool, loading } = useMCPServer();
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async (toolName: string, args: Record<string, unknown>) => {
    setResult(null);
    setError(null);
    setDurationMs(null);

    const start = Date.now();
    const res = await callTool(toolName, args);
    const duration = Date.now() - start;
    setDurationMs(duration);

    if (res.isError) {
      setError(res.content[0]?.text ?? "Unknown error");
    }
    setResult(res);

    // Log to database
    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("mcp_logs").insert({
          user_id: user.id,
          tool: toolName,
          input: args,
          output: res,
          status: res.isError ? "error" : "success",
          duration_ms: duration,
        });
      }
    } catch {
      // Don't block on log failure
    }

    return res;
  };

  return { execute, result, durationMs, loading, error };
}
