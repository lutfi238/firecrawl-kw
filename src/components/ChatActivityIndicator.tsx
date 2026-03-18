import { Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface ChatActivityIndicatorProps {
  steps: string[];
  elapsed: number;
}

export function ChatActivityIndicator({ steps, elapsed }: ChatActivityIndicatorProps) {
  const currentStep = steps[steps.length - 1] || "Thinking…";
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex gap-3">
      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="h-3.5 w-3.5 text-primary animate-pulse" />
      </div>
      <div className="glass rounded-lg px-4 py-2.5 min-w-[160px] max-w-[80%]">
        {/* Completed steps */}
        {steps.length > 1 && (
          <div className="space-y-0.5 mb-1.5">
            {steps.slice(0, -1).map((step, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/50">
                <span className="text-cyber-green">✓</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        )}
        {/* Current step */}
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
          <span className="text-sm text-foreground/80 font-mono">
            {currentStep}{dots}
          </span>
        </div>
        {elapsed > 8 && (
          <p className="text-[10px] text-cyber-amber font-mono mt-1">{elapsed.toFixed(0)}s</p>
        )}
      </div>
    </div>
  );
}
