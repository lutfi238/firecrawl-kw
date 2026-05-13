import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabaseRuntime";

export interface UptimeTarget {
  id: string;
  name: string;
  kind: string;
  url: string;
  method: string;
  expected_status_code: number;
  body_contains: string | null;
  enabled: boolean;
  threshold_degraded_ms: number;
  threshold_down_ms: number;
  check_interval_min: number;
}

export interface UptimeLog {
  id: string;
  target_id: string | null;
  status: string;
  response_ms: number;
  status_code: number | null;
  checked_at: string;
  error: string | null;
  retry_count: number | null;
  body_excerpt: string | null;
}

export function useUptimeTargets() {
  return useQuery({
    queryKey: ["uptime-targets"],
    queryFn: async (): Promise<UptimeTarget[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("uptime_targets")
        .select("*")
        .eq("enabled", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as UptimeTarget[];
    },
    staleTime: 60 * 1000,
  });
}

export function useUptimeLogs(days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return useQuery({
    queryKey: ["uptime-logs", days],
    queryFn: async (): Promise<UptimeLog[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("uptime_logs")
        .select("*")
        .gte("checked_at", since.toISOString())
        .order("checked_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as UptimeLog[];
    },
    refetchInterval: 5 * 60 * 1000, // 5 min
  });
}

export function useTriggerUptimeCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke("uptime-checker");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uptime-logs"] });
    },
  });
}
