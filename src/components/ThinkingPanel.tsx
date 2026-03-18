import { useState, useRef, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingPanelProps {
  content: string;
  durationMs?: number;
  isStreaming?: boolean;
}

function BouncingDots() {
  return (
    <span className="inline-flex gap-0.5 items-center ml-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-secondary-foreground/50 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: "0.6s" }}
        />
      ))}
    </span>
  );
}

export function ThinkingPanel({ content, durationMs, isStreaming = false }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-expand while streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else if (content) {
      // Streaming just finished — collapse after a short delay
      const timer = setTimeout(() => setExpanded(false), 600);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

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
        {isStreaming && <BouncingDots />}
        {!isStreaming && durationLabel && (
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
          expanded ? (isStreaming ? "max-h-32" : "max-h-48") : "max-h-0"
        )}
      >
        <div ref={scrollRef} className="px-3 pb-3 overflow-auto max-h-48 scrollbar-cyber">
          {content ? (
            <p className="text-xs font-mono text-secondary-foreground/50 whitespace-pre-wrap leading-relaxed">
              {content}
            </p>
          ) : isStreaming ? (
            <p className="text-xs font-mono text-secondary-foreground/40 italic">Processing…</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
