import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";
import type { ToolCallResult } from "@/types/mcp";

interface ResponseViewerProps {
  result: ToolCallResult | null;
  durationMs: number | null;
  error?: string | null;
  className?: string;
}

export function ResponseViewer({ result, durationMs, error, className }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);

  if (!result && !error) {
    return (
      <div className={cn("flex items-center justify-center rounded-lg border border-border bg-background/30 p-12", className)}>
        <p className="text-sm font-mono text-muted-foreground/50">Execute a tool to see results here</p>
      </div>
    );
  }

  const content = result
    ? result.content.map((c) => c.text ?? `[${c.type}: ${c.mimeType}]`).join("\n\n")
    : error ?? "";

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("rounded-lg border border-border bg-background/30 flex flex-col", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Response</span>
          {result && (
            <StatusBadge status={result.isError ? "error" : "success"} />
          )}
        </div>
        <div className="flex items-center gap-2">
          {durationMs !== null && (
            <span className="text-xs font-mono text-cyber-cyan">{durationMs}ms</span>
          )}
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1.5 text-xs">
            {copied ? <Check className="h-3 w-3 text-cyber-green" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto p-4 text-sm font-mono text-foreground/80 scrollbar-cyber whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}
