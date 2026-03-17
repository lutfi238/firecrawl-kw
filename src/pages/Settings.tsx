import { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Github, RefreshCw, Trash2, CheckCircle, AlertCircle, Loader2, Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";

const AI_PROVIDERS = [
  { label: "OpenAI Compatible", baseUrl: "", model: "", icon: "🔌" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", icon: "🤖" },
  { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-20241022", icon: "🧠" },
  { label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-Text-01", icon: "⚡" },
  { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", icon: "💎" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", icon: "🔍" },
  { label: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", model: "grok-2-latest", icon: "⚔️" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant", icon: "🚀" },
  { label: "Perplexity", baseUrl: "https://api.perplexity.ai", model: "sonar", icon: "🔮" },
  { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", icon: "🌬️" },
  { label: "Cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", model: "command-r-plus", icon: "🧬" },
  { label: "HuggingFace", baseUrl: "https://api-inference.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct", icon: "🤗" },
  { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.1-8B-Instruct-Turbo", icon: "🤝" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", icon: "🛤️" },
  { label: "Ollama (Local)", baseUrl: "http://localhost:11434/v1", model: "llama3.2", icon: "🏠" },
  { label: "GitHub Copilot", baseUrl: "https://api.githubcopilot.com", model: "claude-haiku-4-5", icon: "🐙" },
  { label: "Z.ai (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", icon: "🇨🇳" },
];

export default function Settings() {
  const { user, githubToken } = useAuthStore();
  const { settings, upsert } = useSettings();
  const { clearLogs } = useRequestLogs();
  const [renderUrl, setRenderUrl] = useState("");
  const [renderSecret, setRenderSecret] = useState("");
  const [rendererEnabled, setRendererEnabled] = useState(false);
  const [githubPat, setGithubPat] = useState("");
  const [savingPat, setSavingPat] = useState(false);
  const [testingRenderer, setTestingRenderer] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<"online" | "offline" | null>(null);
  const [aiProvider, setAiProvider] = useState("OpenAI");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [savingAi, setSavingAi] = useState(false);

  const avatarUrl = user?.user_metadata?.avatar_url;
  const username = user?.user_metadata?.user_name ?? user?.email?.split("@")[0] ?? "User";

  // Initialize from settings
  useEffect(() => {
    if (settings.renderer_url) setRenderUrl(settings.renderer_url);
    if (settings.renderer_secret) setRenderSecret(settings.renderer_secret);
    setRendererEnabled(settings.renderer_enabled === "true");
    if (settings.github_pat) setGithubPat(settings.github_pat);
    if (settings.ai_provider) setAiProvider(settings.ai_provider);
    if (settings.ai_base_url) setAiBaseUrl(settings.ai_base_url);
    if (settings.ai_api_key) setAiApiKey(settings.ai_api_key);
    if (settings.ai_model) setAiModel(settings.ai_model);
  }, [settings]);

  const handleSelectProvider = (label: string) => {
    const provider = AI_PROVIDERS.find((p) => p.label === label);
    if (!provider) return;
    setAiProvider(label);
    setAiBaseUrl(provider.baseUrl);
    setAiModel(provider.model);
  };

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

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      await upsert.mutateAsync({ key: "ai_provider", value: aiProvider });
      await upsert.mutateAsync({ key: "ai_base_url", value: aiBaseUrl });
      await upsert.mutateAsync({ key: "ai_api_key", value: aiApiKey });
      await upsert.mutateAsync({ key: "ai_model", value: aiModel });
      toast.success("AI provider config saved");
    } catch {
      toast.error("Failed to save AI config");
    }
    setSavingAi(false);
  };

  const handleToggleRenderer = async (enabled: boolean) => {
    setRendererEnabled(enabled);
    try {
      await upsert.mutateAsync({ key: "renderer_enabled", value: enabled ? "true" : "false" });
      toast.success(enabled ? "JS Renderer enabled" : "JS Renderer disabled");
    } catch {
      toast.error("Failed to save");
      setRendererEnabled(!enabled);
    }
  };

  const handleSaveRenderer = async () => {
    try {
      await upsert.mutateAsync({ key: "renderer_url", value: renderUrl });
      await upsert.mutateAsync({ key: "renderer_secret", value: renderSecret });
      toast.success("Renderer config saved");
    } catch {
      toast.error("Failed to save");
    }
  };

  const handleTestRenderer = async () => {
    setTestingRenderer(true);
    setRendererStatus(null);
    try {
      const res = await fetch(`${renderUrl}/health`);
      setRendererStatus(res.ok ? "online" : "offline");
    } catch {
      setRendererStatus("offline");
    }
    setTestingRenderer(false);
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

      {/* AI Provider */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI Provider (Extract Tool)
          </h2>
          {settings.ai_provider && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-mono font-semibold text-primary shadow-[0_0_8px_hsl(var(--primary)/0.25)]">
              {AI_PROVIDERS.find((p) => p.label === settings.ai_provider)?.icon ?? "🔌"}{" "}
              {settings.ai_provider}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Select a provider or choose "OpenAI Compatible" to enter a custom endpoint.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Provider</Label>
            <Select value={aiProvider} onValueChange={handleSelectProvider}>
              <SelectTrigger className="font-mono text-sm bg-background/50 border-primary/30 focus:ring-primary/50 shadow-[0_0_6px_hsl(var(--primary)/0.1)]">
                <SelectValue placeholder="Select provider…" />
              </SelectTrigger>
              <SelectContent className="max-h-64 bg-card border-primary/20">
                {AI_PROVIDERS.map((p) => (
                  <SelectItem key={p.label} value={p.label} className="font-mono text-sm">
                    <span className="flex items-center gap-2">
                      <span>{p.icon}</span>
                      <span>{p.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Base URL</Label>
            <Input
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">API Key</Label>
            <Input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder="sk-..."
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Model</Label>
            <Input
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveAi}
              disabled={!aiApiKey || savingAi}
              className="text-xs font-mono border-primary/30 gap-1.5 hover:bg-primary/10 hover:border-primary/50"
            >
              {savingAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              Save Provider Settings
            </Button>
            {settings.ai_api_key && <StatusBadge status="success" label="CONFIGURED" />}
          </div>
        </div>
      </GlassCard>

      {/* Render Renderer */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold">JS Renderer</h2>
          <div className="flex items-center gap-3">
            {rendererEnabled && (
              <StatusBadge status="online" label="ACTIVE" />
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="renderer-toggle" className="text-xs font-mono text-muted-foreground cursor-pointer">
                Enable
              </Label>
              <Switch
                id="renderer-toggle"
                checked={rendererEnabled}
                onCheckedChange={handleToggleRenderer}
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Deploy your renderer to Render.com for free. Enables scrape_js and screenshot tools.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Renderer URL</Label>
            <Input
              value={renderUrl}
              onChange={(e) => setRenderUrl(e.target.value)}
              placeholder="https://your-renderer.onrender.com"
              className="font-mono text-sm bg-background/50 border-border"
              disabled={!rendererEnabled}
            />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Secret</Label>
            <Input
              type="password"
              value={renderSecret}
              onChange={(e) => setRenderSecret(e.target.value)}
              placeholder="Optional shared secret"
              className="font-mono text-sm bg-background/50 border-border"
              disabled={!rendererEnabled}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveRenderer}
              disabled={!rendererEnabled}
              className="text-xs font-mono border-border gap-1.5"
            >
              Save
            </Button>
            {rendererEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestRenderer}
                disabled={!renderUrl || testingRenderer}
                className="text-xs font-mono border-border gap-1.5"
              >
                {testingRenderer ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Test Connection
              </Button>
            )}
            {rendererStatus && <StatusBadge status={rendererStatus === "online" ? "success" : "error"} label={rendererStatus === "online" ? "CONNECTED" : "ERROR"} />}
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
