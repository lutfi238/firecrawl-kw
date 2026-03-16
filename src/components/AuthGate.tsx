import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Github, Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

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
      const authUrl = `${SUPABASE_URL}/functions/v1/github-auth?redirect_uri=${encodeURIComponent(window.location.origin)}`;
      window.location.href = authUrl;
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background dot-grid">
        <div className="glass rounded-xl p-8 max-w-sm w-full mx-4 text-center flex flex-col items-center gap-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-gradient-cyber mb-2">FIRECRAWL MCP</h1>
            <p className="text-sm text-muted-foreground">Personal Web Intelligence Server</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sign in with GitHub to access your MCP dashboard. Your GitHub token will be used for Copilot API access.
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
