import { useState } from "react";
import { useToolExecutor } from "@/hooks/useToolExecutor";
import { ToolForm } from "@/components/ToolForm";
import { ResponseViewer } from "@/components/ResponseViewer";
import { GlassCard } from "@/components/GlassCard";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ToolTester() {
  const [selectedTool, setSelectedTool] = useState(TOOL_DEFINITIONS[0].name);
  const { execute, result, durationMs, loading, error } = useToolExecutor();

  const tool = TOOL_DEFINITIONS.find((t) => t.name === selectedTool)!;

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
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{tool.description}</p>
            <ToolForm
              tool={tool}
              loading={loading}
              onExecute={(args) => execute(tool.name, args)}
            />
          </div>
        </GlassCard>

        {/* Right: Response */}
        <ResponseViewer result={result} durationMs={durationMs} error={error} className="min-h-[400px]" />
      </div>
    </div>
  );
}
