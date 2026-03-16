import { cn } from "@/lib/utils";

type StatusType = "online" | "offline" | "success" | "error" | "pending";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  pulse?: boolean;
  className?: string;
}

const config: Record<StatusType, { color: string; text: string }> = {
  online: { color: "text-cyber-green bg-cyber-green/10 border-cyber-green/30", text: "ONLINE" },
  offline: { color: "text-cyber-red bg-cyber-red/10 border-cyber-red/30", text: "OFFLINE" },
  success: { color: "text-cyber-green bg-cyber-green/10 border-cyber-green/30", text: "SUCCESS" },
  error: { color: "text-cyber-red bg-cyber-red/10 border-cyber-red/30", text: "ERROR" },
  pending: { color: "text-cyber-amber bg-cyber-amber/10 border-cyber-amber/30", text: "PENDING" },
};

export function StatusBadge({ status, label, pulse = false, className }: StatusBadgeProps) {
  const c = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono font-semibold uppercase tracking-wider",
        c.color,
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          pulse && "animate-pulse-glow"
        )}
      />
      {label ?? c.text}
    </span>
  );
}
