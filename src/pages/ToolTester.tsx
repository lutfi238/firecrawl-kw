import { useState, useMemo } from "react";
import { useToolExecutorWithActivity } from "@/hooks/useToolExecutorWithActivity";
import { useSettings } from "@/hooks/useSettings";
import { ToolForm } from "@/components/ToolForm";
import { ResponseViewer } from "@/components/ResponseViewer";
import { ActivityLog } from "@/components/ActivityLog";
import { GlassCard } from "@/components/GlassCard";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function ToolTester() {
  const [selectedTool, setSelectedTool] = useState(TOOL_DEFINITIONS[0].name);
  const { execute, cancel, result, durationMs, loading, error, steps } = useToolExecutorWithActivity();
  const { settings } = useSettings();

  const tool = TOOL_DEFINITIONS.find((t) => t.name === selectedTool)!;

  const toolDescription = useMemo(() => {
    if (tool.name === "extract") {
      const provider = settings.ai_provider;
      const model = settings.ai_model;
      if (provider && model) {
        return `Scrape a URL and use AI (${provider} → ${model}) to extract structured data.`;
      }
      return null; // signal to show "not configured" link
    }
    return tool.description;
  }, [tool, settings.ai_provider, settings.ai_model]);

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
                    {t.name} — {t.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t border-border pt-4">
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
              onExecute={(args) => execute(tool.name, args)}
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

          {/* Activity log */}
          {steps.length > 0 && (
            <ActivityLog steps={steps} className="mt-2" />
          )}
        </GlassCard>

        {/* Right: Response */}
        <ResponseViewer result={result} durationMs={durationMs} error={error} className="min-h-[400px]" />
      </div>
    </div>
  );
}
