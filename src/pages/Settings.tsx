import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useSettings } from "@/hooks/useSettings";
import { useRequestLogs } from "@/hooks/useRequestLogs";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/GlassCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Github, RefreshCw, Trash2, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user, githubToken } = useAuthStore();
  const { settings, upsert } = useSettings();
  const { clearLogs } = useRequestLogs();
  const [railwayUrl, setRailwayUrl] = useState("");
  const [railwaySecret, setRailwaySecret] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [savingPat, setSavingPat] = useState(false);
  const [testingRailway, setTestingRailway] = useState(false);
  const [railwayStatus, setRailwayStatus] = useState<"online" | "offline" | null>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [savingAi, setSavingAi] = useState(false);

  const avatarUrl = user?.user_metadata?.avatar_url;
  const username = user?.user_metadata?.user_name ?? user?.email?.split("@")[0] ?? "User";

  // Initialize from settings
  useState(() => {
    if (settings.railway_url) setRailwayUrl(settings.railway_url);
    if (settings.railway_secret) setRailwaySecret(settings.railway_secret);
    if (settings.github_pat) setGithubPat(settings.github_pat);
  });

  const handleSavePat = async () => {
    setSavingPat(true);
    try {
      await upsert.mutateAsync({ key: "github_pat", value: githubPat });
      toast.success("GitHub PAT saved");
    } catch {
      toast.error("Failed to save PAT");
    }
    setSavingPat(false);
  };

  const handleSaveRailway = async () => {
    try {
      await upsert.mutateAsync({ key: "railway_url", value: railwayUrl });
      await upsert.mutateAsync({ key: "railway_secret", value: railwaySecret });
      toast.success("Railway config saved");
    } catch {
      toast.error("Failed to save");
    }
  };

  const handleTestRailway = async () => {
    setTestingRailway(true);
    setRailwayStatus(null);
    try {
      const res = await fetch(`${railwayUrl}/health`);
      setRailwayStatus(res.ok ? "online" : "offline");
    } catch {
      setRailwayStatus("offline");
    }
    setTestingRailway(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">SETTINGS</h1>

      {/* GitHub OAuth Status */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">GitHub Authentication</h2>
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="bg-muted font-mono">{username[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium text-sm">{username}</p>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status="online" label="CONNECTED" />
              {githubToken ? (
                <StatusBadge status="success" label="COPILOT READY" />
              ) : (
                <StatusBadge status="error" label="NO TOKEN" />
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {!githubToken && (
            <div className="rounded-md border border-cyber-amber/30 bg-cyber-amber/5 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-cyber-amber mt-0.5" />
                <div>
                  <p className="text-xs text-cyber-amber font-medium">GitHub token not available</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Re-authenticate to grant Copilot API access.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Re-authenticate GitHub</p>
                <p className="text-xs text-muted-foreground">
                  Refresh your GitHub token with Copilot and chat scopes.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 w-full sm:w-auto"
                onClick={() => {
                  const origin = window.top?.location.origin || window.location.origin;
                  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-auth?redirect_uri=${encodeURIComponent(origin)}&scope=${encodeURIComponent("read:user user:email copilot github_copilot_chat")}`;
                  if (window.top && window.top !== window) {
                    window.top.location.href = url;
                  } else {
                    window.location.href = url;
                  }
                }}
              >
                <RefreshCw className="h-3 w-3" /> Re-authenticate GitHub
              </Button>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* GitHub PAT for Copilot */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">Copilot API Access</h2>
        <p className="text-xs text-muted-foreground mb-4">
          The extract tool requires a GitHub Personal Access Token (classic) with the <code className="text-primary">copilot</code> scope.
          Generate one at{" "}
          <a
            href="https://github.com/settings/tokens/new?scopes=copilot&description=Firecrawl+MCP+Copilot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            github.com/settings/tokens
          </a>
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">GitHub PAT</Label>
            <Input
              type="password"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSavePat}
              disabled={!githubPat || savingPat}
              className="text-xs font-mono border-border gap-1.5"
            >
              {savingPat ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              Save PAT
            </Button>
            {settings.github_pat && (
              <StatusBadge status="success" label="PAT SAVED" />
            )}
          </div>
        </div>
      </GlassCard>

      {/* Railway Config */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">Railway Renderer</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Optional Playwright renderer for JS-rendered scraping and screenshots. Deploy the renderer to Railway and paste the URL here.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Renderer URL</Label>
            <Input
              value={railwayUrl}
              onChange={(e) => setRailwayUrl(e.target.value)}
              placeholder="https://your-renderer.railway.app"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Secret</Label>
            <Input
              type="password"
              value={railwaySecret}
              onChange={(e) => setRailwaySecret(e.target.value)}
              placeholder="Optional shared secret"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSaveRailway} className="text-xs font-mono border-border gap-1.5">
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestRailway}
              disabled={!railwayUrl || testingRailway}
              className="text-xs font-mono border-border gap-1.5"
            >
              {testingRailway ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Test
            </Button>
            {railwayStatus && <StatusBadge status={railwayStatus} />}
          </div>
        </div>
      </GlassCard>

      {/* Danger Zone */}
      <GlassCard className="border-destructive/30">
        <h2 className="text-xs font-mono uppercase tracking-widest text-destructive mb-4 font-semibold">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Clear all request logs</p>
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearLogs.mutate();
              toast.success("Logs cleared");
            }}
            className="gap-1.5 text-xs font-mono border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" /> Clear Logs
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
