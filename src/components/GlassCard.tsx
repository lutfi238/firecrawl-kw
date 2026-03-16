import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: "cyan" | "violet" | null;
  onClick?: () => void;
}

export function GlassCard({ children, className, hover = true, glow, onClick }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border border-border bg-card/50 backdrop-blur-xl p-6",
        hover && "transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_20px_hsl(var(--cyber-cyan)/0.08),inset_0_0_20px_hsl(var(--cyber-cyan)/0.03)]",
        glow === "cyan" && "glow-cyan",
        glow === "violet" && "glow-violet",
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}
