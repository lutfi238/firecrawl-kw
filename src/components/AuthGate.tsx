import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Github, Loader2 } from "lucide-react";
import { getBackendConfig } from "@/lib/backendConfig";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background dot-grid">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const handleLogin = () => {
      const origin = window.top?.location.origin || window.location.origin;
      const authUrl = `${getBackendConfig().supabaseUrl}/functions/v1/github-auth?redirect_uri=${encodeURIComponent(origin)}&scope=${encodeURIComponent("read:user user:email")}`;
      // Use window.top to break out of iframe (Lovable preview)
      if (window.top && window.top !== window) {
        window.top.location.href = authUrl;
      } else {
        window.location.href = authUrl;
      }
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background dot-grid">
        <div className="glass rounded-xl p-8 max-w-sm w-full mx-4 text-center flex flex-col items-center gap-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-gradient-cyber mb-2">
              FIRECRAWL MCP
            </h1>
            <p className="text-sm text-muted-foreground">
              Personal Web Intelligence Server
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sign in with GitHub to access your MCP dashboard. GitHub Models uses
            a separate token with models:read in Settings.
          </p>
          <Button
            onClick={handleLogin}
            className="w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
          >
            <Github className="h-4 w-4" />
            Login with GitHub
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
