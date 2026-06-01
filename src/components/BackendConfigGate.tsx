import { GlassCard } from "@/components/GlassCard";
import { getBackendConfig, hasValidBackendConfig } from "@/lib/backendConfig";

export function BackendConfigGate({ children }: { children: React.ReactNode }) {
  const config = getBackendConfig();

  if (!hasValidBackendConfig(config)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background dot-grid p-4">
        <GlassCard className="max-w-lg space-y-3">
          <h1 className="font-display text-lg font-bold tracking-widest text-gradient-cyber">
            HOSTED BACKEND NOT CONFIGURED
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This deployment must provide the hosted Supabase environment values:
            <span className="font-mono text-foreground">
              {" "}
              VITE_SUPABASE_URL{" "}
            </span>
            and
            <span className="font-mono text-foreground">
              {" "}
              VITE_SUPABASE_PUBLISHABLE_KEY
            </span>
            . Users do not need to configure their own Supabase project.
          </p>
        </GlassCard>
      </div>
    );
  }

  return <>{children}</>;
}
