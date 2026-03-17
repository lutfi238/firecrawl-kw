import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export interface ActivityStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
  startedAt?: number;
  completedAt?: number;
}

interface ActivityLogProps {
  steps: ActivityStep[];
  className?: string;
}

export function ActivityLog({ steps, className }: ActivityLogProps) {
  if (steps.length === 0) return null;

  return (
    <div className={cn("rounded-lg border border-border bg-background/30 p-3 space-y-1.5 font-mono text-xs", className)}>
      {steps.map((step) => (
        <ActivityLogItem key={step.id} step={step} />
      ))}
    </div>
  );
}

function ActivityLogItem({ step }: { step: ActivityStep }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (step.status !== "active" || !step.startedAt) return;
    const interval = setInterval(() => {
      setElapsed(((Date.now() - step.startedAt!) / 1000));
    }, 100);
    return () => clearInterval(interval);
  }, [step.status, step.startedAt]);

  const duration = step.completedAt && step.startedAt
    ? ((step.completedAt - step.startedAt) / 1000).toFixed(1)
    : step.status === "active" ? elapsed.toFixed(1) : null;

  return (
    <div className={cn(
      "flex items-center gap-2 py-0.5 transition-colors",
      step.status === "active" && "text-[hsl(var(--cyber-cyan))]",
      step.status === "done" && "text-[hsl(var(--cyber-green))]",
      step.status === "error" && "text-destructive",
      step.status === "pending" && "text-muted-foreground/40",
    )}>
      {step.status === "active" && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
      {step.status === "done" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
      {step.status === "error" && <XCircle className="h-3 w-3 shrink-0" />}
      {step.status === "pending" && <span className="h-3 w-3 shrink-0 flex items-center justify-center text-[10px]">○</span>}
      <span className="flex-1">{step.label}</span>
      {step.detail && <span className="text-muted-foreground/60">{step.detail}</span>}
      {duration && <span className="text-muted-foreground/50 tabular-nums">{duration}s</span>}
    </div>
  );
}
