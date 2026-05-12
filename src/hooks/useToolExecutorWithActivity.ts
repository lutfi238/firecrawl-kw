import { useState, useRef, useCallback } from "react";
import { useMCPServer } from "./useMCPServer";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import type { ToolCallResult } from "@/types/mcp";
import type { ActivityStep } from "@/components/ActivityLog";

export function useToolExecutorWithActivity() {
  const { callTool, loading: mcpLoading } = useMCPServer();
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const addStep = (id: string, label: string): ActivityStep => {
    const step: ActivityStep = {
      id,
      label,
      status: "active",
      startedAt: Date.now(),
    };
    setSteps((prev) => [...prev, step]);
    return step;
  };

  const updateStep = (id: string, update: Partial<ActivityStep>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...update } : s)),
    );
  };

  const execute = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      setResult(null);
      setError(null);
      setDurationMs(null);
      setSteps([]);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Timeout at 30s
      const timeout = setTimeout(() => {
        controller.abort();
        setError(
          "Request timed out after 30s. The backend may still be processing — for heavy queries (rankings, research), the chat tool now delegates to async jobs automatically. If this persists for simple queries, check your AI provider settings.",
        );
        updateStep("call", {
          status: "error",
          detail: "Timeout — check if async job was created",
          completedAt: Date.now(),
        });
        setLoading(false);
      }, 30000);

      try {
        // Step: Preparing request
        addStep("prepare", `Preparing ${toolName} request...`);
        await new Promise((r) => setTimeout(r, 50)); // Let UI render
        updateStep("prepare", {
          status: "done",
          detail: "Ready",
          completedAt: Date.now(),
        });

        if (controller.signal.aborted) return;

        // Step: Calling MCP server
        addStep("call", `Executing ${toolName}...`);
        const start = Date.now();
        const res = await callTool(toolName, args);
        const duration = Date.now() - start;

        if (controller.signal.aborted) return;

        clearTimeout(timeout);
        setDurationMs(duration);
        updateStep("call", {
          status: res.isError ? "error" : "done",
          detail: res.isError
            ? "Failed"
            : `Done (${(duration / 1000).toFixed(1)}s)`,
          completedAt: Date.now(),
        });

        if (res.isError) {
          setError(res.content[0]?.text ?? "Unknown error");
        }
        setResult(res);

        // Step: Logging
        addStep("log", "Saving to request log...");
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
          updateStep("log", {
            status: "done",
            detail: "Logged",
            completedAt: Date.now(),
          });
        } catch {
          updateStep("log", {
            status: "error",
            detail: "Log failed",
            completedAt: Date.now(),
          });
        }

        return res;
      } catch (err) {
        clearTimeout(timeout);
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        updateStep("call", {
          status: "error",
          detail: message,
          completedAt: Date.now(),
        });
      } finally {
        clearTimeout(timeout);
        setLoading(false);
        abortRef.current = null;
      }
    },
    [callTool],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError("Cancelled by user");
    setSteps((prev) =>
      prev.map((s) =>
        s.status === "active"
          ? {
              ...s,
              status: "error",
              detail: "Cancelled",
              completedAt: Date.now(),
            }
          : s,
      ),
    );
  }, []);

  return { execute, cancel, result, durationMs, loading, error, steps };
}
