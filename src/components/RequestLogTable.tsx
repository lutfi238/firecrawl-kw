import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { SourceBadge } from "./SourceBadge";
import { cn } from "@/lib/utils";
import type { McpLogEntry } from "@/types/mcp";

interface RequestLogTableProps {
  logs: McpLogEntry[];
  className?: string;
}

export function RequestLogTable({ logs, className }: RequestLogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border bg-background/30 p-12",
          className,
        )}
      >
        <p className="text-sm font-mono text-muted-foreground/50">
          No requests logged yet
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border overflow-hidden",
        className,
      )}
    >
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold w-8" />
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Time
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Source
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Tool
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold hidden md:table-cell">
              Input
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Status
            </th>
            <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const expanded = expandedId === log.id;
            return (
              <>
                <tr
                  key={log.id}
                  onClick={() => setExpandedId(expanded ? null : log.id)}
                  className={cn(
                    "border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/20",
                    i % 2 === 0 && "bg-muted/5",
                  )}
                >
                  <td className="px-4 py-2">
                    {expanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">
                    <SourceBadge source={log.source} />
                  </td>
                  <td className="px-4 py-2 text-xs text-cyber-cyan">
                    {log.tool}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[200px] hidden md:table-cell">
                    {log.input ? JSON.stringify(log.input).slice(0, 60) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      status={log.status === "success" ? "success" : "error"}
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-muted-foreground">
                    {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                  </td>
                </tr>
                {expanded && (
                  <tr
                    key={`${log.id}-detail`}
                    className="border-b border-border/50"
                  >
                    <td colSpan={7} className="p-4 bg-background/30">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
                            Input
                          </h4>
                          <pre className="text-xs bg-muted/20 rounded p-3 overflow-auto max-h-48 scrollbar-cyber whitespace-pre-wrap">
                            {JSON.stringify(log.input, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
                            Output
                          </h4>
                          <pre className="text-xs bg-muted/20 rounded p-3 overflow-auto max-h-48 scrollbar-cyber whitespace-pre-wrap">
                            {JSON.stringify(log.output, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
