import { useState, useEffect, useRef, useCallback } from "react";
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

interface SourceInfo {
  sourceUrl?: string;
  finalUrl?: string;
  title?: string;
  publisher?: string;
  contentLength?: number;
  resolveStatus?: string;
  scrapeStatus?: string;
  error?: string;
}

interface EvidenceMetrics {
  sourcesCollected?: number;
  sourcesResolved?: number;
  sourcesScrapedSuccessfully?: number;
  sourcesUsableForSynthesis?: number;
  failedSources?: number;
  emptyContentSources?: number;
}

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
  sources?: SourceInfo[];
  evidenceMetrics?: EvidenceMetrics;
  groundedness?: string;
  warning?: string;
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
  { key: "queued", label: "Queued", shortLabel: "Queue" },
  { key: "searching", label: "Searching", shortLabel: "Search" },
  { key: "scraping", label: "Scraping", shortLabel: "Scrape" },
  { key: "extracting", label: "Extracting", shortLabel: "Extract" },
  { key: "synthesizing", label: "Synthesizing", shortLabel: "Synth" },
  { key: "completed", label: "Completed", shortLabel: "Done" },
  { key: "failed", label: "Failed", shortLabel: "Fail" },
] as const;

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/* ── Helpers ───────────────────────────────────────── */

function parseAgentData(result: ToolCallResult | null): AgentJobData | null {
  if (!result?.content?.[0]?.text) return null;
  try {
    const raw = result.content[0].text;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const data = (typeof obj.result === "object" && obj.result !== null ? obj.result : obj) as Record<string, unknown>;

    const sourcesRaw = data.sourcesUsed ?? data.sources_used;
    const sourcesUsed = Array.isArray(sourcesRaw) ? sourcesRaw.filter((s): s is string => typeof s === "string") : undefined;

    const sourcesDetailRaw = data.sources ?? data.source_details;
    const sources = Array.isArray(sourcesDetailRaw) ? sourcesDetailRaw as SourceInfo[] : undefined;

    const metricsRaw = data.evidenceMetrics ?? data.evidence_metrics;
    const evidenceMetrics = (typeof metricsRaw === "object" && metricsRaw !== null) ? metricsRaw as EvidenceMetrics : undefined;

    const scrapedRaw = data.scrapedCount ?? data.scraped_count;
    const scrapedCount = typeof scrapedRaw === "number" ? scrapedRaw : sourcesUsed?.length ?? undefined;

    return {
      jobId: String(data.jobId ?? data.job_id ?? data.id ?? ""),
      type: typeof data.type === "string" ? data.type : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
      step: typeof data.step === "string" ? data.step : undefined,
      scrapedCount,
      createdAt: String(data.createdAt ?? data.created_at ?? ""),
      updatedAt: String(data.updatedAt ?? data.updated_at ?? ""),
      result: data.result ?? data.output ?? data.synthesis,
      error: typeof data.error === "string" ? data.error : undefined,
      sourcesUsed,
      sources,
      evidenceMetrics,
      groundedness: typeof data.groundedness === "string" ? data.groundedness : undefined,
      warning: typeof data.warning === "string" ? data.warning : undefined,
    };
  } catch {
    return null;
  }
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatFullTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
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
    default: return "pending"; // unknown status → neutral pending
  }
}

function getStepIndex(step?: string): number {
  if (!step) return -1;
  return AGENT_STEPS.findIndex((s) => s.key === step);
}

function getStatusSentence(data: AgentJobData): string {
  const count = data.scrapedCount;
  const usable = data.evidenceMetrics?.sourcesUsableForSynthesis;
  const countStr = count != null && count > 0
    ? `${count} scraped source${count !== 1 ? "s" : ""}`
    : null;

  if (data.status === "completed") {
    // Low/no evidence completions
    if (data.groundedness === "none") {
      return data.warning || "The job completed but no usable article content was found.";
    }
    if (data.groundedness === "low") {
      return `The job completed with limited evidence (${usable ?? 0} usable source${(usable ?? 0) !== 1 ? "s" : ""}). Synthesis may lack grounding.`;
    }
    if (data.warning) {
      return `The job completed with warnings: ${data.warning}`;
    }
    return countStr
      ? `The job has completed successfully with ${countStr}.`
      : "The job has completed successfully.";
  }
  if (data.status === "failed") {
    if (data.error) return `The job failed: ${data.error}`;
    if (data.step) return `The job failed during the ${data.step} step.`;
    return "The job failed before completion.";
  }

  // In-progress states
  switch (data.step) {
    case "queued":
      return "The job is queued and waiting to start.";
    case "searching":
      return "The agent is searching the web for relevant sources…";
    case "scraping":
      return countStr
        ? `The agent is scraping URLs (${countStr} so far)…`
        : "The agent is scraping discovered URLs…";
    case "extracting":
      return "The agent is extracting structured data from scraped content…";
    case "synthesizing":
      return countStr
        ? `The agent is synthesizing results from ${countStr}.`
        : "The agent is synthesizing results…";
    default:
      return data.status === "processing"
        ? "The job is currently processing."
        : "Waiting for job status…";
  }
}

/* ── Progress Stepper ──────────────────────────────── */

function ProgressStepper({ currentStep, status }: { currentStep?: string; status?: string }) {
  const isFailed = status === "failed";
  const isCompleted = status === "completed";

  const failedIdx = AGENT_STEPS.findIndex((s) => s.key === "failed");
  const completedIdx = AGENT_STEPS.findIndex((s) => s.key === "completed");

  const activeIdx = isCompleted
    ? completedIdx
    : isFailed
      ? failedIdx
      : getStepIndex(currentStep);

  // The step the job was on when it failed
  const failedAtIdx = isFailed ? getStepIndex(currentStep) : -1;

  return (
    <div className="flex items-center gap-1 w-full overflow-x-auto py-2">
      {AGENT_STEPS.map((step, i) => {
        // Hide "failed" step unless job actually failed
        if (step.key === "failed" && !isFailed) return null;
        // Hide "completed" step if job failed
        if (step.key === "completed" && isFailed) return null;

        const isDone = isCompleted
          ? i <= completedIdx
          : isFailed
            ? i < failedAtIdx || (failedAtIdx === -1 && i < failedIdx)
            : i < activeIdx;
        const isActive = i === activeIdx;
        const isFailedStep = isFailed && step.key === "failed";

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
                  isDone ? "bg-cyber-green/40" : isFailedStep ? "bg-cyber-red/30" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Summary Card ──────────────────────────────────── */

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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // Force re-render for relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const data = parseAgentData(result);
  const isTerminal = data?.status != null && TERMINAL_STATUSES.has(data.status);

  // Schedule next poll only after current refresh completes (recursive timeout)
  useEffect(() => {
    if (!autoRefresh || isTerminal || loading) return;

    // When loading just finished (loading=false) and auto is on, schedule next
    cancelledRef.current = false;
    timeoutRef.current = setTimeout(() => {
      if (!cancelledRef.current) {
        onRefresh();
      }
    }, 2000);

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [autoRefresh, isTerminal, loading, onRefresh]);

  // Auto-stop on terminal state
  useEffect(() => {
    if (isTerminal && autoRefresh) {
      setAutoRefresh(false);
    }
  }, [isTerminal, autoRefresh]);

  // Manual refresh — safe because it just calls onRefresh directly
  const safeRefresh = useCallback(() => {
    if (!loading) onRefresh();
  }, [onRefresh, loading]);

  // ─── Empty state ───
  if (!result && !error) {
    return (
      <div className={cn("flex flex-col items-center justify-center rounded-lg border border-border bg-background/30 p-12 gap-3", className)}>
        <Bot className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm font-mono text-muted-foreground/50">Execute agent_status to monitor a job</p>
      </div>
    );
  }

  // ─── Request error with no parseable data ───
  if (!data && error) {
    return (
      <div className={cn("rounded-lg border border-cyber-red/30 bg-cyber-red/5 p-6", className)}>
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-4 w-4 text-cyber-red" />
          <span className="text-sm font-mono text-cyber-red">Request Error</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">{error}</p>
      </div>
    );
  }

  // ─── Unparseable response (result exists but data is null) ───
  if (!data && result) {
    return (
      <div className={cn("rounded-lg border border-border bg-background/30 flex flex-col", className)}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Agent Monitor</span>
          <StatusBadge status={result.isError ? "error" : "success"} label={result.isError ? "REQUEST FAILED" : "REQUEST OK"} />
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-cyber-amber" />
            <span className="text-xs font-mono text-cyber-amber">Could not parse agent job data from response</span>
          </div>
          <ResponseViewer result={result} durationMs={durationMs} error={error} className="border-0 rounded-none min-h-[200px]" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-background/30 flex flex-col", className)}>
      {/* ── Header with polling controls ── */}
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
            onClick={safeRefresh}
            disabled={loading}
            className="h-7 gap-1.5 text-xs font-mono"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </Button>
          <div className="flex items-center gap-1.5">
            <Switch
              checked={autoRefresh}
              onCheckedChange={(checked) => setAutoRefresh(checked)}
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

      {/* ── Tabbed content ── */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-3 w-fit bg-muted/50">
          <TabsTrigger value="overview" className="text-xs font-mono">Overview</TabsTrigger>
          <TabsTrigger value="json" className="text-xs font-mono">Raw JSON</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs font-mono">Activity Log</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="flex-1 p-4 space-y-4 overflow-auto scrollbar-cyber">
          {data ? (
            <>
              {/* Status sentence */}
              <div className={cn(
                "rounded-md border p-3",
                data.status === "failed" ? "border-cyber-red/30 bg-cyber-red/5" :
                data.groundedness === "none" ? "border-cyber-red/30 bg-cyber-red/5" :
                data.groundedness === "low" ? "border-cyber-amber/30 bg-cyber-amber/5" :
                data.warning ? "border-cyber-amber/30 bg-cyber-amber/5" :
                "border-border bg-muted/10"
              )}>
                <p className={cn(
                  "text-sm leading-relaxed",
                  data.status === "failed" ? "text-cyber-red/90" :
                  data.groundedness === "none" ? "text-cyber-red/90" :
                  data.groundedness === "low" || data.warning ? "text-cyber-amber/90" :
                  "text-foreground/80"
                )}>
                  {getStatusSentence(data)}
                </p>
              </div>

              {/* Progress stepper */}
              <ProgressStepper currentStep={data.step} status={data.status} />

              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <SummaryCard
                  icon={Hash}
                  label="Job ID"
                  value={
                    <span className="text-xs" title={data.jobId || undefined}>
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
                      pulse={data.status === "processing"}
                    />
                  }
                />
                <SummaryCard
                  icon={Bot}
                  label="Current Step"
                  value={data.step ?? (data.status === "completed" ? "completed" : "—")}
                  accent="text-primary"
                />
                <SummaryCard
                  icon={Globe}
                  label="Sources Scraped"
                  value={data.scrapedCount != null ? data.scrapedCount : "—"}
                />
                <SummaryCard
                  icon={Calendar}
                  label="Updated"
                  value={
                    <span title={formatFullTimestamp(data.updatedAt)}>
                      {relativeTime(data.updatedAt)}
                    </span>
                  }
                />
              </div>

              {/* Evidence quality metrics */}
              {data.evidenceMetrics && (
                <div className="rounded-md border border-border bg-muted/10 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Evidence Quality</p>
                    {data.groundedness && (
                      <span className={cn(
                        "text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border",
                        data.groundedness === "high" && "border-cyber-green/40 text-cyber-green bg-cyber-green/10",
                        data.groundedness === "medium" && "border-cyber-amber/40 text-cyber-amber bg-cyber-amber/10",
                        data.groundedness === "low" && "border-cyber-red/40 text-cyber-red bg-cyber-red/10",
                        data.groundedness === "none" && "border-cyber-red/40 text-cyber-red bg-cyber-red/10",
                      )}>
                        {data.groundedness} groundedness
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    <div><span className="text-muted-foreground">Collected:</span> {data.evidenceMetrics.sourcesCollected ?? "—"}</div>
                    <div><span className="text-muted-foreground">Resolved:</span> {data.evidenceMetrics.sourcesResolved ?? "—"}</div>
                    <div><span className="text-muted-foreground">Scraped:</span> {data.evidenceMetrics.sourcesScrapedSuccessfully ?? "—"}</div>
                    <div><span className="text-muted-foreground">Usable:</span> {data.evidenceMetrics.sourcesUsableForSynthesis ?? "—"}</div>
                    <div><span className="text-muted-foreground">Failed:</span> {data.evidenceMetrics.failedSources ?? "—"}</div>
                    <div><span className="text-muted-foreground">Empty:</span> {data.evidenceMetrics.emptyContentSources ?? "—"}</div>
                  </div>
                </div>
              )}

              {/* Warning banner */}
              {data.warning && (
                <div className="rounded-md border border-cyber-amber/30 bg-cyber-amber/5 p-3 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-cyber-amber mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-cyber-amber/90">{data.warning}</p>
                </div>
              )}

              {/* Timestamps row */}
              {(data.createdAt || data.updatedAt) && (
                <div className="flex gap-4 text-[10px] font-mono text-muted-foreground/60">
                  {data.createdAt && <span>Created: {formatFullTimestamp(data.createdAt)}</span>}
                  {data.updatedAt && <span>Updated: {formatFullTimestamp(data.updatedAt)}</span>}
                </div>
              )}

              {/* Sources list — structured diagnostics */}
              {data.sources && data.sources.length > 0 && (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    Source Diagnostics ({data.sources.length})
                  </p>
                  <div className="space-y-2">
                    {data.sources.map((src, i) => (
                      <div key={i} className="text-xs font-mono border border-border/60 rounded p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground/80 truncate">{src.title || src.publisher || "Unknown"}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{src.publisher || "unknown-domain"}</span>
                        </div>

                        <div className="text-[10px] space-y-0.5">
                          <div className="text-muted-foreground">Source URL</div>
                          <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:text-primary truncate block">{src.sourceUrl || "—"}</a>
                        </div>

                        <div className="text-[10px] space-y-0.5">
                          <div className="text-muted-foreground">Final URL</div>
                          {src.finalUrl ? (
                            <a href={src.finalUrl} target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:text-primary truncate block">{src.finalUrl}</a>
                          ) : (
                            <span className="text-cyber-amber">unresolved</span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-[10px]">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded border",
                            src.resolveStatus === "resolved" && "border-cyber-green/40 text-cyber-green",
                            src.resolveStatus === "unchanged" && "border-muted text-muted-foreground",
                            src.resolveStatus === "unresolved_wrapper" && "border-cyber-amber/40 text-cyber-amber",
                            src.resolveStatus === "failed" && "border-cyber-red/40 text-cyber-red",
                          )}>resolve: {src.resolveStatus || "—"}</span>
                          <span className={cn(
                            "px-1.5 py-0.5 rounded border",
                            src.scrapeStatus === "success" && "border-cyber-green/40 text-cyber-green",
                            (src.scrapeStatus === "empty" || src.scrapeStatus === "boilerplate" || src.scrapeStatus === "unresolved_wrapper") && "border-cyber-amber/40 text-cyber-amber",
                            src.scrapeStatus === "failed" && "border-cyber-red/40 text-cyber-red",
                          )}>scrape: {src.scrapeStatus || "—"}</span>
                          <span className="text-muted-foreground">content: {src.contentLength ?? 0}</span>
                        </div>

                        {src.error && (
                          <div className="text-[10px] text-cyber-red/80 break-words">error: {src.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fallback: plain URL list if no rich sources */}
              {!data.sources && data.sourcesUsed && data.sourcesUsed.length > 0 && (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    Sources Used ({data.sourcesUsed.length})
                  </p>
                  <div className="space-y-1">
                    {data.sourcesUsed.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="block text-xs font-mono text-primary/80 hover:text-primary truncate">
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Synthesis result on completion */}
              {data.status === "completed" && data.result && (
                <div className="rounded-md border border-cyber-green/20 bg-cyber-green/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-cyber-green mb-2">Synthesis Result</p>
                  <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap break-words max-h-60 overflow-auto scrollbar-cyber">
                    {typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error details on failure */}
              {data.status === "failed" && (
                <div className="rounded-md border border-cyber-red/30 bg-cyber-red/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-cyber-red mb-1">Error Details</p>
                  <p className="text-xs font-mono text-cyber-red/80">
                    {data.error ?? "No error message provided. Check the Raw JSON tab for details."}
                  </p>
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

        {/* ── Raw JSON Tab ── */}
        <TabsContent value="json" className="flex-1">
          <ResponseViewer result={result} durationMs={durationMs} error={error} className="border-0 rounded-none min-h-[300px]" />
        </TabsContent>

        {/* ── Activity Log Tab ── */}
        <TabsContent value="activity" className="flex-1 p-4">
          {steps.length > 0 ? (
            <ActivityLog steps={steps} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs font-mono text-muted-foreground/50">No activity recorded yet</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
