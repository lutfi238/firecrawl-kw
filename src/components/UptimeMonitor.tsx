import { useMemo, useState } from "react";
import {
  useUptimeLogs,
  useUptimeTargets,
  useTriggerUptimeCheck,
  type UptimeLog,
  type UptimeTarget,
} from "@/hooks/useUptimeLogs";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "up" | "degraded" | "down" | "unknown";

const STATUS_LABEL: Record<Status, string> = {
  up: "OPERATIONAL",
  degraded: "DEGRADED",
  down: "DOWN",
  unknown: "UNKNOWN",
};

function statusDotClass(status: Status): string {
  if (status === "up") {
    return "bg-[hsl(var(--cyber-green))] shadow-[0_0_8px_hsl(var(--cyber-green))]";
  }
  if (status === "degraded") {
    return "bg-[hsl(var(--cyber-amber))] shadow-[0_0_8px_hsl(var(--cyber-amber))]";
  }
  if (status === "down") {
    return "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]";
  }
  return "bg-muted-foreground";
}

function aggregateOverallStatus(perTarget: Status[]): Status {
  if (perTarget.length === 0) return "unknown";
  if (perTarget.includes("down")) return "down";
  if (perTarget.includes("degraded")) return "degraded";
  if (perTarget.every((s) => s === "up")) return "up";
  return "unknown";
}

function calcUptimePercent(logs: UptimeLog[], sinceMs: number): string | null {
  const filtered = logs.filter(
    (l) => new Date(l.checked_at).getTime() >= sinceMs,
  );
  if (!filtered.length) return null;
  const goodCount = filtered.filter(
    (l) => l.status === "up" || l.status === "degraded",
  ).length;
  return ((goodCount / filtered.length) * 100).toFixed(2);
}

function dayBlocksFor(logs: UptimeLog[]) {
  const blocks: { date: string; status: Status }[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLogs = logs.filter((l) => l.checked_at.slice(0, 10) === dateStr);
    if (!dayLogs.length) {
      blocks.push({ date: dateStr, status: "unknown" });
      continue;
    }
    if (dayLogs.some((l) => l.status === "down")) {
      blocks.push({ date: dateStr, status: "down" });
    } else if (dayLogs.some((l) => l.status === "degraded")) {
      blocks.push({ date: dateStr, status: "degraded" });
    } else {
      blocks.push({ date: dateStr, status: "up" });
    }
  }
  return blocks;
}

function incidentsFor(logs: UptimeLog[]) {
  const events: {
    start: string;
    end: string;
    durationMs: number;
    severity: "down" | "degraded";
  }[] = [];
  let openStart: string | null = null;
  let openSeverity: "down" | "degraded" | null = null;

  for (const log of logs) {
    const sev =
      log.status === "down"
        ? "down"
        : log.status === "degraded"
          ? "degraded"
          : null;

    if (sev && !openStart) {
      openStart = log.checked_at;
      openSeverity = sev;
    } else if (sev && openStart) {
      // upgrade severity if it goes from degraded to down within the same incident
      if (sev === "down" && openSeverity === "degraded") openSeverity = "down";
    } else if (!sev && openStart && openSeverity) {
      events.push({
        start: openStart,
        end: log.checked_at,
        durationMs:
          new Date(log.checked_at).getTime() - new Date(openStart).getTime(),
        severity: openSeverity,
      });
      openStart = null;
      openSeverity = null;
    }
  }

  if (openStart && openSeverity) {
    events.push({
      start: openStart,
      end: "ongoing",
      durationMs: Date.now() - new Date(openStart).getTime(),
      severity: openSeverity,
    });
  }

  return events.reverse().slice(0, 10);
}

function formatRelative(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function UptimeMonitor() {
  const { data: targets = [] } = useUptimeTargets();
  const { data: logs = [], isLoading } = useUptimeLogs(90);
  const trigger = useTriggerUptimeCheck();
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);

  // Group logs per target for fast lookups
  const logsByTarget = useMemo(() => {
    const map = new Map<string, UptimeLog[]>();
    for (const log of logs) {
      const key = log.target_id ?? "legacy";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return map;
  }, [logs]);

  const targetLatestStatus = useMemo(() => {
    const out = new Map<string, Status>();
    for (const target of targets) {
      const arr = logsByTarget.get(target.id) ?? [];
      const last = arr[arr.length - 1];
      out.set(target.id, (last?.status as Status) ?? "unknown");
    }
    return out;
  }, [logsByTarget, targets]);

  const overallStatus = useMemo(
    () => aggregateOverallStatus(Array.from(targetLatestStatus.values())),
    [targetLatestStatus],
  );

  const lastCheckedAt = useMemo(() => {
    if (!logs.length) return null;
    return new Date(logs[logs.length - 1].checked_at).getTime();
  }, [logs]);

  // Active target defaults to the first one, or the first target with the worst status
  const focusedTargetId = activeTargetId ?? targets[0]?.id ?? null;
  const focusedTarget: UptimeTarget | null =
    targets.find((t) => t.id === focusedTargetId) ?? null;
  const focusedLogs: UptimeLog[] = focusedTargetId
    ? (logsByTarget.get(focusedTargetId) ?? [])
    : logs;

  const stats = useMemo(() => {
    const now = Date.now();
    const last24h = focusedLogs.filter(
      (l) => new Date(l.checked_at).getTime() >= now - 24 * 3600 * 1000,
    );
    const avgMs = last24h.length
      ? Math.round(
          last24h.reduce((s, l) => s + (l.response_ms ?? 0), 0) /
            last24h.length,
        )
      : null;
    return {
      uptime24h: calcUptimePercent(focusedLogs, now - 24 * 3600 * 1000),
      uptime7d: calcUptimePercent(focusedLogs, now - 7 * 24 * 3600 * 1000),
      uptime30d: calcUptimePercent(focusedLogs, now - 30 * 24 * 3600 * 1000),
      avgMs,
    };
  }, [focusedLogs]);

  const chartData = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    return focusedLogs
      .filter((l) => new Date(l.checked_at).getTime() >= since)
      .map((l) => ({
        time: new Date(l.checked_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        ms: l.response_ms,
        status: l.status,
      }));
  }, [focusedLogs]);

  const dayBlocks = useMemo(() => dayBlocksFor(focusedLogs), [focusedLogs]);
  const incidents = useMemo(() => incidentsFor(focusedLogs), [focusedLogs]);

  const chartConfig = {
    ms: { label: "Response (ms)", color: "hsl(var(--cyber-cyan))" },
  };

  return (
    <div className="space-y-4">
      {/* Status pill */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-3 w-3 rounded-full",
              statusDotClass(overallStatus),
            )}
          />
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-bold tracking-wider">
              {STATUS_LABEL[overallStatus]}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {lastCheckedAt
                ? `last check ${formatRelative(lastCheckedAt)}`
                : "no checks yet"}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="gap-1.5 text-xs font-mono border-border"
        >
          <RefreshCw
            className={cn("h-3 w-3", trigger.isPending && "animate-spin")}
          />
          Check Now
        </Button>
      </div>

      {/* Per-target cards */}
      {targets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {targets.map((target) => {
            const status = targetLatestStatus.get(target.id) ?? "unknown";
            const arr = logsByTarget.get(target.id) ?? [];
            const last = arr[arr.length - 1];
            const isActive = focusedTargetId === target.id;
            return (
              <button
                type="button"
                key={target.id}
                onClick={() => setActiveTargetId(target.id)}
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors",
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-background/40 hover:bg-background/60",
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      statusDotClass(status),
                    )}
                  />
                  <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground truncate">
                    {target.name}
                  </span>
                </div>
                <div className="mt-1 text-sm font-bold font-mono">
                  {STATUS_LABEL[status]}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">
                  {last
                    ? `${last.response_ms}ms • ${formatRelative(new Date(last.checked_at).getTime())}`
                    : "no data"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Focused target heading */}
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {focusedTarget ? `Focused: ${focusedTarget.name}` : "All targets"}
        </h3>
        {focusedTargetId && targets.length > 1 && (
          <button
            type="button"
            onClick={() => setActiveTargetId(null)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            View aggregate
          </button>
        )}
      </div>

      {/* Uptime % cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "24h", value: stats.uptime24h },
          { label: "7d", value: stats.uptime7d },
          { label: "30d", value: stats.uptime30d },
        ].map((s) => (
          <GlassCard key={s.label} className="p-3 text-center">
            <div className="text-xs font-mono text-muted-foreground mb-1">
              Uptime {s.label}
            </div>
            <div
              className={cn(
                "text-xl font-bold font-mono",
                s.value === null
                  ? "text-muted-foreground"
                  : Number(s.value) >= 99
                    ? "text-[hsl(var(--cyber-green))]"
                    : Number(s.value) >= 95
                      ? "text-[hsl(var(--cyber-amber))]"
                      : "text-destructive",
              )}
            >
              {s.value !== null ? `${s.value}%` : "—"}
            </div>
          </GlassCard>
        ))}
        <GlassCard className="p-3 text-center">
          <div className="text-xs font-mono text-muted-foreground mb-1">
            Avg Response
          </div>
          <div className="text-xl font-bold font-mono text-primary">
            {stats.avgMs !== null ? `${stats.avgMs}ms` : "—"}
          </div>
        </GlassCard>
      </div>

      {/* Latency chart */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3 flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> RESPONSE TIME (24H)
        </h3>
        {chartData.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
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
            {isLoading
              ? "Loading…"
              : "No data yet — click 'Check Now' to start"}
          </div>
        )}
      </GlassCard>

      {/* 90-day uptime bar */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3">
          UPTIME HISTORY (90 DAYS)
        </h3>
        <div className="flex gap-[2px]">
          {dayBlocks.map((block) => (
            <div
              key={block.date}
              title={`${block.date}: ${block.status}`}
              className={cn(
                "flex-1 h-6 rounded-sm",
                block.status === "up"
                  ? "bg-[hsl(var(--cyber-green))]"
                  : block.status === "degraded"
                    ? "bg-[hsl(var(--cyber-amber))]"
                    : block.status === "down"
                      ? "bg-destructive"
                      : "bg-muted",
              )}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-mono text-muted-foreground">
            90 days ago
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            Today
          </span>
        </div>
      </GlassCard>

      {/* Incidents */}
      <GlassCard className="p-4">
        <h3 className="text-xs font-mono text-muted-foreground mb-3 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> RECENT INCIDENTS
        </h3>
        {incidents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-mono">Severity</TableHead>
                <TableHead className="text-xs font-mono">Started</TableHead>
                <TableHead className="text-xs font-mono">Duration</TableHead>
                <TableHead className="text-xs font-mono">Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((inc, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        inc.severity === "down"
                          ? "border-destructive text-destructive"
                          : "border-[hsl(var(--cyber-amber))] text-[hsl(var(--cyber-amber))]",
                      )}
                    >
                      {inc.severity.toUpperCase()}
                    </Badge>
                  </TableCell>
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
                      <Badge variant="destructive" className="text-[10px]">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="bg-[hsl(var(--cyber-green))] text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Resolved
                      </Badge>
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
