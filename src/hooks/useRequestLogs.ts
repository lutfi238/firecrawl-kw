import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import type { McpLogEntry } from "@/types/mcp";

interface LogFilters {
  tool?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useRequestLogs(filters?: LogFilters) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["mcp-logs", filters],
    queryFn: async (): Promise<McpLogEntry[]> => {
      const supabase = getSupabaseClient();
      let q = supabase
        .from("mcp_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters?.tool) q = q.eq("tool", filters.tool);
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as McpLogEntry[];
    },
    refetchInterval: 3000,
  });

  const clearLogs = useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("mcp_logs")
        .delete()
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-logs"] }),
  });

  return { ...query, clearLogs };
}

export function useLogStats() {
  return useQuery({
    queryKey: ["mcp-log-stats"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("mcp_logs")
        .select("tool, status, created_at")
        .gte("created_at", today.toISOString());

      if (error) throw error;
      const logs = data ?? [];
      return {
        totalToday: logs.length,
        successToday: logs.filter((l) => l.status === "success").length,
        errorToday: logs.filter((l) => l.status === "error").length,
        toolCounts: logs.reduce((acc: Record<string, number>, l) => {
          acc[l.tool] = (acc[l.tool] || 0) + 1;
          return acc;
        }, {}),
      };
    },
    refetchInterval: 5000,
  });
}
