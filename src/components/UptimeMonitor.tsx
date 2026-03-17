import { useMemo } from "react";
import { useUptimeLogs, useTriggerUptimeCheck } from "@/hooks/useUptimeLogs";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { RefreshCw, Activity } from "lucide-react";

export function UptimeMonitor() {
  const { data: logs = [], isLoading } = useUptimeLogs(90);
  const trigger = useTriggerUptimeCheck();

  const stats = useMemo(() => {
    const now = Date.now();
    const d24h = now - 24 * 60 * 60 * 1000;
    const d7d = now - 7 * 24 * 60 * 60 * 1000;
    const d30d = now - 30 * 24 * 60 * 60 * 1000;

    const calc = (since: number) => {
      const filtered = logs.filter((l) => new Date(l.checked_at).getTime() >= since);
      if (!filtered.length) return null;
      const up = filtered.filter((l) => l.status === "up").length;
      return ((up / filtered.length) * 100).toFixed(2);
    };

    const last24h = logs.filter((l) => new Date(l.checked_at).getTime() >= d24h);
    const avgMs = last24h.length
      ? Math.round(last24h.reduce((s, l) => s + l.response_ms, 0) / last24h.length)
      : null;

    const currentStatus = logs.length > 0 ? logs[logs.length - 1].status : "unknown";

    return {
      currentStatus,
      uptime24h: calc(d24h),
      uptime7d: calc(d7d),
      uptime30d: calc(d30d),
      avgResponseMs: avgMs,
    };
  }, [logs]);

  // Response time chart data (last 24h)
  const chartData = useMemo(() => {
    const d24h = Date.now() - 24 * 60 * 60 * 1000;
    return logs
      .filter((l) => new Date(l.checked_at).getTime() >= d24h)
      .map((l) => ({
        time: new Date(l.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ms: l.response_ms,
        status: l.status,
      }));
  }, [logs]);

  // 90-day uptime blocks
  const dayBlocks = useMemo(() => {
    const blocks: { date: string; status: "up" | "down" | "none" }[] = [];
    const now = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLogs = logs.filter((l) => l.checked_at.slice(0, 10) === dateStr);
      if (!dayLogs.length) {
        blocks.push({ date: dateStr, status: "none" });
      } else {
        const hasDown = dayLogs.some((l) => l.status === "down");
        blocks.push({ date: dateStr, status: hasDown ? "down" : "up" });
      }
    }
    return blocks;
  }, [logs]);

  // Incidents
  const incidents = useMemo(() => {
    const downPeriods: { start: string; end: string; durationMs: number }[] = [];
    let downStart: string | null = null;

    for (const log of logs) {
      if (log.status === "down" && !downStart) {
        downStart = log.checked_at;
      } else if (log.status === "up" && downStart) {
        const dur = new Date(log.checked_at).getTime() - new Date(downStart).getTime();
        downPeriods.push({ start: downStart, end: log.checked_at, durationMs: dur });
        downStart = null;
      }
    }
    if (downStart) {
      downPeriods.push({ start: downStart, end: "ongoing", durationMs: Date.now() - new Date(downStart).getTime() });
    }
    return downPeriods.reverse().slice(0, 10);
  }, [logs]);

  const chartConfig = {
    ms: { label: "Response (ms)", color: "hsl(var(--cyber-cyan))" },
  };

  return (
    <div className="space-y-4">
      {/* Status + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${
              stats.currentStatus === "up"
                ? "bg-[hsl(var(--cyber-green))] shadow-[0_0_8px_hsl(var(--cyber-green))]"
                : stats.currentStatus === "down"
                ? "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]"
                : "bg-muted-foreground"
            }`}
          />
          <span className="font-display text-lg font-bold tracking-wider">
            {stats.currentStatus === "up" ? "OPERATIONAL" : stats.currentStatus === "down" ? "DEGRADED" : "UNKNOWN"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="gap-1.5 text-xs font-mono border-border"
        >
          <RefreshCw className={`h-3 w-3 ${trigger.isPending ? "animate-spin" : ""}`} />
          Check Now
        </Button>
      </div>

      {/* Uptime percentages + avg response */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "24h", value: stats.uptime24h },
          { label: "7d", value: stats.uptime7d },
          { label: "30d", value: stats.uptime30d },
        ].map((s) => (
          <GlassCard key={s.label} className="p-3 text-center">
            <div className="text-xs font-mono text-muted-foreground mb-1">Uptime {s.label}</div>
            <div
              className={`text-xl font-bold font-mono ${
                s.value === null
                  ? "text-muted-foreground"
                  : Number(s.value) >= 99
                  ? "text-[hsl(var(--cyber-green))]"
                  : Number(s.value) >= 95
                  ? "text-[hsl(var(--cyber-amber))]"
                  : "text-destructive"
              }`}
            >
              {s.value !== null ? `${s.value}%` : "—"}
            </div>
          </GlassCard>
        ))}
        <GlassCard className="p-3 text-center">
          <div className="text-xs font-mono text-muted-foreground mb-1">Avg Response</div>
          <div className="text-xl font-bold font-mono text-primary">
            {stats.avgResponseMs !== null ? `${stats.avgResponseMs}ms` : "—"}
          </div>
        </GlassCard>
      </div>

      {/* Response time chart */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3 flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> RESPONSE TIME (24H)
        </h3>
        {chartData.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="ms"
                stroke="hsl(var(--cyber-cyan))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "hsl(var(--cyber-cyan))" }}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-xs font-mono">
            No data yet — click "Check Now" to start
          </div>
        )}
      </GlassCard>

      {/* 90-day uptime bar */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3">UPTIME HISTORY (90 DAYS)</h3>
        <div className="flex gap-[2px]">
          {dayBlocks.map((block) => (
            <div
              key={block.date}
              title={`${block.date}: ${block.status}`}
              className={`flex-1 h-6 rounded-sm ${
                block.status === "up"
                  ? "bg-[hsl(var(--cyber-green))]"
                  : block.status === "down"
                  ? "bg-destructive"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-mono text-muted-foreground">90 days ago</span>
          <span className="text-[10px] font-mono text-muted-foreground">Today</span>
        </div>
      </GlassCard>

      {/* Incidents table */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3">RECENT INCIDENTS</h3>
        {incidents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-mono">Started</TableHead>
                <TableHead className="text-xs font-mono">Duration</TableHead>
                <TableHead className="text-xs font-mono">Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((inc, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">
                    {new Date(inc.start).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {inc.end === "ongoing"
                      ? "Ongoing"
                      : `${Math.round(inc.durationMs / 1000 / 60)}m`}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {inc.end === "ongoing" ? (
                      <Badge variant="destructive" className="text-[10px]">Active</Badge>
                    ) : (
                      <Badge className="bg-[hsl(var(--cyber-green))] text-[10px]">Resolved</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-xs font-mono text-muted-foreground text-center py-4">
            No incidents recorded
          </div>
        )}
      </GlassCard>
    </div>
  );
}
