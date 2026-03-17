import { useState, useEffect, useRef, useCallback } from "react";
import { GlassCard } from "./GlassCard";
import { StatusBadge } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityLog } from "./ActivityLog";
import { ResponseViewer } from "./ResponseViewer";
import {
  RefreshCw,
  Clock,
  Hash,
  Layers,
  Globe,
  Calendar,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallResult } from "@/types/mcp";
import type { ActivityStep } from "./ActivityLog";

/* ── Types ─────────────────────────────────────────── */

interface AgentJobData {
  jobId?: string;
  type?: string;
  status?: string;
  step?: string;
  scrapedCount?: number;
  createdAt?: string;
  updatedAt?: string;
  result?: unknown;
  error?: string;
  sourcesUsed?: string[];
}

interface AgentJobMonitorProps {
  result: ToolCallResult | null;
  durationMs: number | null;
  error?: string | null;
  steps: ActivityStep[];
  onRefresh: () => void;
  loading: boolean;
  className?: string;
}

/* ── Constants ─────────────────────────────────────── */

const AGENT_STEPS = [
  { key: "queued", label: "Queued" },
  { key: "searching", label: "Searching" },
  { key: "scraping", label: "Scraping" },
  { key: "extracting", label: "Extracting" },
  { key: "synthesizing", label: "Synthesizing" },
  { key: "completed", label: "Completed" },
] as const;

/* ── Helpers ───────────────────────────────────────── */

function parseAgentData(result: ToolCallResult | null): AgentJobData | null {
  if (!result?.content?.[0]?.text) return null;
  try {
    const parsed = JSON.parse(result.content[0].text);
    // Handle nested response wrapper
    const data = parsed.result ?? parsed;
    return {
      jobId: data.jobId ?? data.id,
      type: data.type,
      status: data.status,
      step: data.step,
      scrapedCount: data.scrapedCount ?? data.scraped_count ?? data.sourcesUsed?.length,
      createdAt: data.createdAt ?? data.created_at,
      updatedAt: data.updatedAt ?? data.updated_at,
      result: data.result ?? data.output,
      error: data.error,
      sourcesUsed: data.sourcesUsed ?? data.sources_used,
    };
  } catch {
    return null;
  }
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function jobStatusToBadge(status?: string): "online" | "offline" | "pending" | "success" | "error" {
  switch (status) {
    case "completed": return "success";
    case "failed": return "error";
    case "processing": return "pending";
    case "pending": return "pending";
    default: return "pending";
  }
}

function getStepIndex(step?: string): number {
  if (!step) return -1;
  const idx = AGENT_STEPS.findIndex((s) => s.key === step);
  return idx;
}

function getStatusSentence(data: AgentJobData): string {
  if (data.status === "completed") {
    const count = data.scrapedCount ?? 0;
    return count > 0
      ? `The job has completed successfully with ${count} scraped source${count !== 1 ? "s" : ""}.`
      : "The job has completed successfully.";
  }
  if (data.status === "failed") {
    return data.error
      ? `The job failed: ${data.error}`
      : `The job failed before ${data.step ?? "completion"}.`;
  }
  if (data.step === "synthesizing") {
    const count = data.scrapedCount ?? 0;
    return count > 0
      ? `The agent is currently synthesizing results from ${count} scraped source${count !== 1 ? "s" : ""}.`
      : "The agent is currently synthesizing results.";
  }
  if (data.step === "scraping") {
    return "The agent is scraping discovered URLs...";
  }
  if (data.step === "searching") {
    return "The agent is searching the web for relevant sources...";
  }
  if (data.step === "extracting") {
    return "The agent is extracting structured data from scraped content...";
  }
  return "The job is still processing.";
}

/* ── Stepper ───────────────────────────────────────── */

function ProgressStepper({ currentStep, status }: { currentStep?: string; status?: string }) {
  const isFailed = status === "failed";
  const isCompleted = status === "completed";
  const activeIdx = isCompleted ? AGENT_STEPS.length - 1 : getStepIndex(currentStep);

  return (
    <div className="flex items-center gap-1 w-full overflow-x-auto py-2">
      {AGENT_STEPS.map((step, i) => {
        const isDone = isCompleted || i < activeIdx;
        const isActive = !isCompleted && i === activeIdx;
        const isFailedStep = isFailed && isActive;

        return (
          <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                  isDone && "border-cyber-green bg-cyber-green/20",
                  isActive && !isFailedStep && "border-primary bg-primary/20 animate-pulse",
                  isFailedStep && "border-cyber-red bg-cyber-red/20",
                  !isDone && !isActive && "border-border bg-muted/30"
                )}
              >
                {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-cyber-green" />}
                {isActive && !isFailedStep && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                {isFailedStep && <AlertCircle className="h-3.5 w-3.5 text-cyber-red" />}
                {!isDone && !isActive && <Circle className="h-3 w-3 text-muted-foreground/30" />}
              </div>
              <span
                className={cn(
                  "text-[10px] font-mono uppercase tracking-wider text-center leading-tight",
                  isDone && "text-cyber-green",
                  isActive && !isFailedStep && "text-primary",
                  isFailedStep && "text-cyber-red",
                  !isDone && !isActive && "text-muted-foreground/40"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < AGENT_STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 min-w-2 mt-[-16px]",
                  isDone ? "bg-cyber-green/40" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Summary Cards ─────────────────────────────────── */

function SummaryCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 flex items-start gap-3 min-w-0">
      <div className={cn("rounded-md p-1.5 bg-muted/50 flex-shrink-0", accent)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="text-sm font-mono mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────── */

export function AgentJobMonitor({
  result,
  durationMs,
  error,
  steps,
  onRefresh,
  loading,
  className,
}: AgentJobMonitorProps) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [now, setNow] = useState(Date.now());

  const data = parseAgentData(result);
  const isTerminal = data?.status === "completed" || data?.status === "failed";

  // Update relative time every second
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh polling
  useEffect(() => {
    if (autoRefresh && !isTerminal) {
      intervalRef.current = setInterval(() => {
        onRefresh();
      }, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [autoRefresh, isTerminal, onRefresh]);

  // Auto-stop when terminal
  useEffect(() => {
    if (isTerminal && autoRefresh) {
      setAutoRefresh(false);
    }
  }, [isTerminal, autoRefresh]);

  const handleToggleAutoRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  // No result yet — show placeholder
  if (!result && !error) {
    return (
      <div className={cn("flex flex-col items-center justify-center rounded-lg border border-border bg-background/30 p-12 gap-3", className)}>
        <Bot className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm font-mono text-muted-foreground/50">Execute agent_status to monitor a job</p>
      </div>
    );
  }

  // Error with no parseable data
  if (!data && error) {
    return (
      <div className={cn("rounded-lg border border-cyber-red/30 bg-cyber-red/5 p-6", className)}>
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-4 w-4 text-cyber-red" />
          <span className="text-sm font-mono text-cyber-red">Error</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-background/30 flex flex-col", className)}>
      {/* Header with polling controls */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Agent Monitor</span>
          {result && !result.isError && <StatusBadge status="success" label="REQUEST OK" />}
          {result?.isError && <StatusBadge status="error" label="REQUEST FAILED" />}
        </div>
        <div className="flex items-center gap-3">
          {durationMs !== null && (
            <span className="text-xs font-mono text-primary">{durationMs}ms</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 gap-1.5 text-xs font-mono"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </Button>
          <div className="flex items-center gap-1.5">
            <Switch
              checked={autoRefresh}
              onCheckedChange={handleToggleAutoRefresh}
              disabled={isTerminal}
              className="scale-75"
            />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              Auto
            </span>
            {autoRefresh && !isTerminal && (
              <span className="h-1.5 w-1.5 rounded-full bg-cyber-green animate-pulse-glow" />
            )}
          </div>
        </div>
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-3 w-fit bg-muted/50">
          <TabsTrigger value="overview" className="text-xs font-mono">Overview</TabsTrigger>
          <TabsTrigger value="json" className="text-xs font-mono">Raw JSON</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs font-mono">Activity Log</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="flex-1 p-4 space-y-4 overflow-auto">
          {data ? (
            <>
              {/* Status sentence */}
              <div className="rounded-md border border-border bg-muted/10 p-3">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {getStatusSentence(data)}
                </p>
              </div>

              {/* Progress stepper */}
              <ProgressStepper currentStep={data.step} status={data.status} />

              {/* Summary cards grid */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <SummaryCard
                  icon={Hash}
                  label="Job ID"
                  value={
                    <span className="text-xs" title={data.jobId}>
                      {data.jobId ? `${data.jobId.slice(0, 8)}…` : "—"}
                    </span>
                  }
                />
                <SummaryCard
                  icon={Layers}
                  label="Type"
                  value={data.type ?? "—"}
                  accent="text-secondary"
                />
                <SummaryCard
                  icon={Clock}
                  label="Job Status"
                  value={
                    <StatusBadge
                      status={jobStatusToBadge(data.status)}
                      label={data.status?.toUpperCase() ?? "UNKNOWN"}
                    />
                  }
                />
                <SummaryCard
                  icon={Bot}
                  label="Current Step"
                  value={data.step ?? "—"}
                  accent="text-primary"
                />
                <SummaryCard
                  icon={Globe}
                  label="Sources Scraped"
                  value={data.scrapedCount ?? 0}
                />
                <SummaryCard
                  icon={Calendar}
                  label="Updated"
                  value={
                    <span title={formatTimestamp(data.updatedAt)}>
                      {relativeTime(data.updatedAt)}
                    </span>
                  }
                />
              </div>

              {/* Sources list if available */}
              {data.sourcesUsed && data.sourcesUsed.length > 0 && (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Sources Used</p>
                  <div className="space-y-1">
                    {data.sourcesUsed.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs font-mono text-primary/80 hover:text-primary truncate"
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Result preview if completed */}
              {data.status === "completed" && data.result && (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Synthesis Result</p>
                  <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap break-words max-h-60 overflow-auto scrollbar-cyber">
                    {typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error details if failed */}
              {data.status === "failed" && data.error && (
                <div className="rounded-md border border-cyber-red/30 bg-cyber-red/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-cyber-red mb-1">Error Details</p>
                  <p className="text-xs font-mono text-cyber-red/80">{data.error}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <AlertCircle className="h-5 w-5 text-muted-foreground/30" />
              <p className="text-xs font-mono text-muted-foreground/50">Could not parse agent job data</p>
            </div>
          )}
        </TabsContent>

        {/* Raw JSON Tab */}
        <TabsContent value="json" className="flex-1">
          <ResponseViewer result={result} durationMs={durationMs} error={error} className="border-0 rounded-none min-h-[300px]" />
        </TabsContent>

        {/* Activity Log Tab */}
        <TabsContent value="activity" className="flex-1 p-4">
          {steps.length > 0 ? (
            <ActivityLog steps={steps} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs font-mono text-muted-foreground/50">No activity yet</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
