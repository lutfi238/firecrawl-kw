import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UptimeLog {
  id: string;
  status: string;
  response_ms: number;
  status_code: number | null;
  checked_at: string;
}

export function useUptimeLogs(days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return useQuery({
    queryKey: ["uptime-logs", days],
    queryFn: async (): Promise<UptimeLog[]> => {
      const { data, error } = await supabase
        .from("uptime_logs" as any)
        .select("*")
        .gte("checked_at", since.toISOString())
        .order("checked_at", { ascending: true })
        .limit(1000);
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
      const { data, error } = await supabase.functions.invoke("uptime-checker");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uptime-logs"] });
    },
  });
}
