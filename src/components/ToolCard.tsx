import { GlassCard } from "./GlassCard";
import {
  Search, FileText, Globe, Network, Map, Brain, Camera,
  SearchCode, Code, Layers, Timer, Bot, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  Search, FileText, Globe, Network, Map, Brain, Camera, SearchCode, Code, Layers, Timer, Bot, MessageSquare,
};

interface ToolCardProps {
  name: string;
  description: string;
  icon: string;
  category: string;
  usageCount?: number;
  onClick?: () => void;
  className?: string;
}

const categoryColors: Record<string, string> = {
  search: "text-cyber-cyan",
  scrape: "text-cyber-green",
  crawl: "text-cyber-violet",
  ai: "text-cyber-amber",
  utility: "text-muted-foreground",
  async: "text-cyber-cyan",
};

export function ToolCard({ name, description, icon, category, usageCount, onClick, className }: ToolCardProps) {
  const Icon = iconMap[icon] ?? Code;

  return (
    <GlassCard onClick={onClick} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <div className={cn("flex items-center gap-2.5", categoryColors[category])}>
          <Icon className="h-5 w-5" />
          <span className="font-mono text-sm font-semibold tracking-wide">{name}</span>
        </div>
        {usageCount !== undefined && (
          <span className="text-xs font-mono text-muted-foreground">{usageCount} calls</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
      <div className="mt-auto">
        <span className="inline-block rounded-full border border-border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {category}
        </span>
      </div>
    </GlassCard>
  );
}
