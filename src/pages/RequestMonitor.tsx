import { useState } from "react";
import { useRequestLogs } from "@/hooks/useRequestLogs";
import { RequestLogTable } from "@/components/RequestLogTable";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { Download, Trash2, RefreshCw } from "lucide-react";
import { UptimeMonitor } from "@/components/UptimeMonitor";
import { KNOWN_SOURCES, getSourceMeta } from "@/components/SourceBadge";

export default function RequestMonitor() {
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const filters = {
    tool: toolFilter !== "all" ? toolFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    source: sourceFilter !== "all" ? sourceFilter : undefined,
  };

  const { data: logs, isLoading, refetch, clearLogs } = useRequestLogs(filters);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs ?? [], null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
        REQUEST MONITOR
      </h1>

      <Tabs defaultValue="logs" className="w-full">
        <TabsList className="bg-muted/50 border border-border">
          <TabsTrigger
            value="logs"
            className="text-xs font-mono data-[state=active]:text-primary"
          >
            Request Logs
          </TabsTrigger>
          <TabsTrigger
            value="uptime"
            className="text-xs font-mono data-[state=active]:text-primary"
          >
            Uptime Monitor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex items-center justify-end flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5 text-xs font-mono border-border"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-1.5 text-xs font-mono border-border"
            >
              <Download className="h-3 w-3" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearLogs.mutate()}
              className="gap-1.5 text-xs font-mono border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
          </div>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Tool:
                </span>
                <Select value={toolFilter} onValueChange={setToolFilter}>
                  <SelectTrigger className="w-[140px] h-8 text-xs font-mono bg-background/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all" className="text-xs font-mono">
                      All Tools
                    </SelectItem>
                    {TOOL_DEFINITIONS.map((t) => (
                      <SelectItem
                        key={t.name}
                        value={t.name}
                        className="text-xs font-mono"
                      >
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Status:
                </span>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[120px] h-8 text-xs font-mono bg-background/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all" className="text-xs font-mono">
                      All
                    </SelectItem>
                    <SelectItem value="success" className="text-xs font-mono">
                      Success
                    </SelectItem>
                    <SelectItem value="error" className="text-xs font-mono">
                      Error
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Source:
                </span>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-xs font-mono bg-background/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all" className="text-xs font-mono">
                      All Sources
                    </SelectItem>
                    {KNOWN_SOURCES.map((src) => (
                      <SelectItem
                        key={src}
                        value={src}
                        className="text-xs font-mono"
                      >
                        {getSourceMeta(src).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-xs font-mono text-muted-foreground ml-auto">
                {logs?.length ?? 0} entries • Auto-refresh 3s
              </span>
            </div>
          </GlassCard>

          <RequestLogTable logs={logs ?? []} />
        </TabsContent>

        <TabsContent value="uptime">
          <UptimeMonitor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
