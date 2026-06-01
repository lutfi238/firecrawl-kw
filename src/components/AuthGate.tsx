import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, Loader2, Lock, LogIn, Mail, UserPlus } from "lucide-react";
import { getBackendConfig } from "@/lib/backendConfig";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuthStore();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background dot-grid">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const handleSupabaseAuth = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const credentials = { email: email.trim(), password };
      if (!credentials.email || !credentials.password) return;

      setSubmitting(true);
      setAuthError("");
      try {
        const supabase = getSupabaseClient();
        const { error } =
          mode === "sign-in"
            ? await supabase.auth.signInWithPassword(credentials)
            : await supabase.auth.signUp(credentials);

        if (error) {
          setAuthError(error.message);
          toast.error(error.message);
          return;
        }

        if (mode === "sign-up") {
          toast.success("Supabase account created");
        } else {
          toast.success("Signed in");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Supabase login failed";
        setAuthError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    };

    const handleGithubLogin = () => {
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
        <div className="glass rounded-xl p-8 max-w-sm w-full mx-4 flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-gradient-cyber mb-2">
              FIRECRAWL MCP
            </h1>
            <p className="text-sm text-muted-foreground">
              Personal Web Intelligence Server
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {mode === "sign-in"
                ? "Sign in with Supabase"
                : "Create Supabase account"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Use your own Supabase Auth account to manage personal MCP secrets,
              settings, logs, and jobs from this dashboard.
            </p>
          </div>

          <form className="space-y-3" onSubmit={handleSupabaseAuth}>
            <div className="space-y-1.5">
              <label
                htmlFor="auth-email"
                className="text-xs font-mono text-muted-foreground"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="pl-9 bg-background/50 border-border"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="auth-password"
                className="text-xs font-mono text-muted-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your Supabase password"
                  className="pl-9 bg-background/50 border-border"
                />
              </div>
            </div>

            {authError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {authError}
              </p>
            )}

            <Button
              type="submit"
              disabled={!email.trim() || !password || submitting}
              className="w-full gap-2"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "sign-in" ? (
                <LogIn className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {mode === "sign-in"
                ? "Sign in with Supabase"
                : "Create Supabase account"}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleGithubLogin}
            className="w-full gap-2"
          >
            <Github className="h-4 w-4" />
            Continue with GitHub
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAuthError("");
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            }}
            className="text-xs"
          >
            {mode === "sign-in" ? "Create account" : "Back to sign in"}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
