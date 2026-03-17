import { useState, useMemo, useCallback } from "react";
import { useToolExecutorWithActivity } from "@/hooks/useToolExecutorWithActivity";
import { useSettings } from "@/hooks/useSettings";
import { ToolForm } from "@/components/ToolForm";
import { ResponseViewer } from "@/components/ResponseViewer";
import { ActivityLog } from "@/components/ActivityLog";
import { AgentJobMonitor } from "@/components/AgentJobMonitor";
import { GlassCard } from "@/components/GlassCard";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { XCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

export default function ToolTester() {
  const [selectedTool, setSelectedTool] = useState(TOOL_DEFINITIONS[0].name);
  const { execute, cancel, result, durationMs, loading, error, steps } = useToolExecutorWithActivity();
  const { settings } = useSettings();
  const [lastArgs, setLastArgs] = useState<Record<string, unknown> | null>(null);

  const tool = TOOL_DEFINITIONS.find((t) => t.name === selectedTool)!;
  const rendererEnabled = settings.renderer_enabled === "true";
  const isToolDisabled = tool.requiresRenderer && !rendererEnabled;
  const isAgentStatus = selectedTool === "agent_status";

  const toolDescription = useMemo(() => {
    if (tool.name === "extract") {
      const provider = settings.ai_provider;
      const model = settings.ai_model;
      if (provider && model) {
        return `Scrape a URL and use AI (${provider} → ${model}) to extract structured data.`;
      }
      return null;
    }
    return tool.description;
  }, [tool, settings.ai_provider, settings.ai_model]);

  const handleExecute = useCallback((args: Record<string, unknown>) => {
    setLastArgs(args);
    execute(tool.name, args);
  }, [execute, tool.name]);

  const handleRefresh = useCallback(() => {
    if (lastArgs) {
      execute(tool.name, lastArgs);
    }
  }, [execute, tool.name, lastArgs]);

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">TOOL TESTER</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Tool selection + form */}
        <GlassCard className="space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 block">Select Tool</label>
            <Select value={selectedTool} onValueChange={setSelectedTool}>
              <SelectTrigger className="font-mono text-sm bg-background/50 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {TOOL_DEFINITIONS.map((t) => (
                  <SelectItem key={t.name} value={t.name} className="font-mono text-sm">
                    <span className="flex items-center gap-2">
                      <span>{t.name} — {t.category}</span>
                      {t.requiresRenderer && !rendererEnabled && (
                        <span className="text-[10px] text-muted-foreground/50">(disabled)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t border-border pt-4">
            {isToolDisabled && (
              <div className="rounded-md border border-cyber-amber/30 bg-cyber-amber/5 p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-cyber-amber mt-0.5" />
                  <div>
                    <p className="text-xs text-cyber-amber font-medium">⚠️ Renderer not configured</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Enable the JS Renderer in{" "}
                      <Link to="/settings" className="text-primary underline underline-offset-2 hover:text-primary/80">
                        Settings
                      </Link>{" "}
                      to use this tool.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {toolDescription ? (
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{toolDescription}</p>
            ) : (
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Scrape a URL and use AI to extract structured data.{" "}
                <Link to="/settings" className="text-primary underline underline-offset-2 hover:text-primary/80">
                  Configure AI provider in Settings →
                </Link>
              </p>
            )}
            <ToolForm
              tool={tool}
              loading={loading}
              disabled={isToolDisabled}
              onExecute={handleExecute}
            />
            {loading && (
              <Button
                variant="outline"
                size="sm"
                onClick={cancel}
                className="mt-2 w-full text-xs font-mono border-destructive/50 text-destructive hover:bg-destructive/10 gap-1.5"
              >
                <XCircle className="h-3 w-3" /> Cancel
              </Button>
            )}
          </div>

          {/* Activity log — only show inline for non-agent-status tools */}
          {!isAgentStatus && steps.length > 0 && (
            <ActivityLog steps={steps} className="mt-2" />
          )}
        </GlassCard>

        {/* Right: Response — agent_status gets dedicated monitor */}
        {isAgentStatus ? (
          <AgentJobMonitor
            result={result}
            durationMs={durationMs}
            error={error}
            steps={steps}
            onRefresh={handleRefresh}
            loading={loading}
            className="min-h-[400px]"
          />
        ) : (
          <ResponseViewer result={result} durationMs={durationMs} error={error} className="min-h-[400px]" />
        )}
      </div>
    </div>
  );
}
