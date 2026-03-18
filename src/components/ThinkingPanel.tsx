import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingPanelProps {
  content: string;
  durationMs?: number;
}

export function ThinkingPanel({ content, durationMs }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const durationLabel = durationMs != null && durationMs > 0
    ? `${(durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div className="rounded-xl border border-secondary/20 bg-gradient-to-br from-secondary/10 to-accent/10 mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-secondary-foreground/60 hover:text-secondary-foreground/80 transition-colors"
      >
        <span>🧠</span>
        <span className="font-semibold">Thinking</span>
        {durationLabel && (
          <span className="text-muted-foreground/50">· {durationLabel}</span>
        )}
        <ChevronRight
          className={cn(
            "h-3 w-3 ml-auto transition-transform duration-300",
            expanded && "rotate-90"
          )}
        />
      </button>
      <div
        className={cn(
          "transition-all duration-300 ease-in-out overflow-hidden",
          expanded ? "max-h-48" : "max-h-0"
        )}
      >
        <div className="px-3 pb-3 overflow-auto max-h-48 scrollbar-cyber">
          <p className="text-xs font-mono text-secondary-foreground/50 whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        </div>
      </div>
    </div>
  );
}
