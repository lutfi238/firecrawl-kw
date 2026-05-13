import { Cloud, Globe2, Bot, Code2, Terminal, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const SOURCE_META: Record<string, SourceMeta> = {
  "claude-web": {
    label: "Claude Web",
    icon: Sparkles,
    className: "border-cyber-violet/40 text-cyber-violet bg-cyber-violet/10",
  },
  "claude-desktop": {
    label: "Claude Desktop",
    icon: Bot,
    className: "border-cyber-violet/40 text-cyber-violet bg-cyber-violet/10",
  },
  zed: {
    label: "Zed",
    icon: Code2,
    className: "border-cyber-cyan/40 text-cyber-cyan bg-cyber-cyan/10",
  },
  cursor: {
    label: "Cursor",
    icon: Code2,
    className: "border-cyber-cyan/40 text-cyber-cyan bg-cyber-cyan/10",
  },
  vscode: {
    label: "VS Code",
    icon: Code2,
    className: "border-cyber-cyan/40 text-cyber-cyan bg-cyber-cyan/10",
  },
  "stdio-proxy": {
    label: "Stdio Proxy",
    icon: Terminal,
    className: "border-border text-muted-foreground bg-muted/30",
  },
  "local-client": {
    label: "Local",
    icon: Terminal,
    className: "border-border text-muted-foreground bg-muted/30",
  },
  "remote-mcp": {
    label: "Remote MCP",
    icon: Cloud,
    className: "border-border text-muted-foreground bg-muted/30",
  },
  dashboard: {
    label: "Dashboard",
    icon: Globe2,
    className: "border-cyber-green/40 text-cyber-green bg-cyber-green/10",
  },
};

const FALLBACK: SourceMeta = {
  label: "Unknown",
  icon: Zap,
  className: "border-border text-muted-foreground bg-muted/30",
};

export function getSourceMeta(source: string | null | undefined): SourceMeta {
  if (!source) return FALLBACK;
  return SOURCE_META[source] || { ...FALLBACK, label: source };
}

export const KNOWN_SOURCES = Object.keys(SOURCE_META);

export function SourceBadge({
  source,
  className,
}: {
  source: string | null | undefined;
  className?: string;
}) {
  const meta = getSourceMeta(source);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
        meta.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
