import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMCPServer } from "@/hooks/useMCPServer";
import { useLogStats } from "@/hooks/useRequestLogs";
import { useSettings } from "@/hooks/useSettings";
import { GlassCard } from "@/components/GlassCard";
import { ConfigCopier } from "@/components/ConfigCopier";
import { ToolCard } from "@/components/ToolCard";
import { StatusBadge } from "@/components/StatusBadge";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { Copy, Check, Zap, Wrench, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBackendConfig } from "@/lib/backendConfig";

export default function Overview() {
  const navigate = useNavigate();
  const { pingServer } = useMCPServer();
  const { data: stats } = useLogStats();
  const { settings } = useSettings();
  const backendConfig = getBackendConfig();
  const mcpEndpoint = backendConfig.mcpEndpoint;
  const [online, setOnline] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    pingServer().then(setOnline);
  }, [pingServer]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(mcpEndpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const claudeConfig = useMemo(() => {
    const config: Record<string, unknown> = {
      mcpServers: {
        "firecrawl-kw": {
          url: mcpEndpoint,
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }, [mcpEndpoint]);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Title */}
      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-bold text-gradient-cyber tracking-wider">
          PERSONAL FIRECRAWL MCP
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Web intelligence server — 17 tools for search, scrape, crawl & AI
          extraction
        </p>
      </div>

      {/* Status + Endpoint */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Server Status
            </span>
            <StatusBadge
              status={
                online === null ? "pending" : online ? "online" : "offline"
              }
              pulse={online === true}
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 text-xs font-mono text-foreground/70 bg-background/50 rounded px-3 py-2 truncate border border-border">
              {mcpEndpoint}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleCopyUrl}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-cyber-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </GlassCard>

        {/* Stats */}
        <GlassCard>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="flex items-center justify-center gap-1.5 text-cyber-cyan mb-1">
                <Zap className="h-4 w-4" />
              </div>
              <p className="text-xl font-display font-bold">
                {stats?.totalToday ?? 0}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">
                Today
              </p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-cyber-green mb-1">
                <BarChart3 className="h-4 w-4" />
              </div>
              <p className="text-xl font-display font-bold">
                {stats?.successToday ?? 0}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">
                Success
              </p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-cyber-violet mb-1">
                <Wrench className="h-4 w-4" />
              </div>
              <p className="text-xl font-display font-bold">17</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">
                Tools
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Claude Config */}
      <ConfigCopier
        content={claudeConfig}
        label="Claude Code CLI Config (~/.claude.json)"
      />

      {/* Tool Cards Grid */}
      <div>
        <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground mb-4">
          AVAILABLE TOOLS
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOOL_DEFINITIONS.map((tool) => (
            <ToolCard
              key={tool.name}
              {...tool}
              usageCount={stats?.toolCounts?.[tool.name] ?? 0}
              onClick={() => navigate(`/tester?tool=${tool.name}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
