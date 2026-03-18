import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolTraceStep } from "@/types/mcp";

interface ToolTraceCollapsibleProps {
  trace: ToolTraceStep[];
}

export function ToolTraceCollapsible({ trace }: ToolTraceCollapsibleProps) {
  const [open, setOpen] = useState(false);

  if (trace.length === 0) return null;

  const toolNames = [...new Set(trace.map((t) => t.tool))];
  const summary = toolNames.join(" → ");

  return (
    <div className="mt-2 border-t border-border/30 pt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        <span>Used: {summary}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 pl-4">
          {trace.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/40"
            >
              <span>{step.icon}</span>
              <span>{step.label}</span>
              {step.durationMs != null && (
                <span className="text-muted-foreground/30">
                  ({(step.durationMs / 1000).toFixed(1)}s)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
