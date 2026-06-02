import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useSettings } from "@/hooks/useSettings";
import { useRequestLogs } from "@/hooks/useRequestLogs";
import { useMCPServer } from "@/hooks/useMCPServer";

import { GlassCard } from "@/components/GlassCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Github,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Bot,
  Sparkles,
  Zap,
  Clock,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { getBackendConfig } from "@/lib/backendConfig";

const GITHUB_MODELS_PROVIDER = "GitHub Models";
const GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";

type GitHubModelCatalogItem = {
  id: string;
  name?: string;
  publisher?: string;
  summary?: string;
  rate_limit_tier?: string;
  capabilities?: string[];
  limits?: {
    max_input_tokens?: number;
    max_output_tokens?: number;
  };
};

const AI_PROVIDERS = [
  { label: "OpenAI Compatible", baseUrl: "", model: "", icon: "🔌" },
  {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    icon: "🤖",
  },
  {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-haiku-20241022",
    icon: "🧠",
  },
  {
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
    icon: "⚡",
  },
  {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    icon: "💎",
  },
  {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    icon: "🔍",
  },
  {
    label: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-2-latest",
    icon: "⚔️",
  },
  {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
    icon: "🚀",
  },
  {
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    model: "sonar",
    icon: "🔮",
  },
  {
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    icon: "🌬️",
  },
  {
    label: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    model: "command-r-plus",
    icon: "🧬",
  },
  {
    label: "HuggingFace",
    baseUrl: "https://api-inference.huggingface.co/v1",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    icon: "🤗",
  },
  {
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
    icon: "🤝",
  },
  {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    icon: "🛤️",
  },
  {
    label: "Ollama (Local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    icon: "🏠",
  },
  {
    label: GITHUB_MODELS_PROVIDER,
    baseUrl: GITHUB_MODELS_BASE_URL,
    model: "openai/gpt-4.1",
    icon: "🐙",
  },
  {
    label: "Z.ai (Zhipu)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    icon: "🇨🇳",
  },
  {
    label: "Alibaba Cloud (DashScope Singapore)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    icon: "☁️",
  },
  {
    label: "OpenAdapter",
    baseUrl: "https://api.openadapter.in/v1",
    model: "custom-model",
    icon: "🔗",
  },
];

export default function Settings() {
  const { user, githubToken } = useAuthStore();
  const { settings, upsert } = useSettings();
  const { clearLogs } = useRequestLogs();
  const { callTool } = useMCPServer();
  const [rendererProvider, setRendererProvider] = useState("none");
  const [renderUrl, setRenderUrl] = useState("");
  const [renderSecret, setRenderSecret] = useState("");
  const [savingRenderer, setSavingRenderer] = useState(false);
  const [testingRenderer, setTestingRenderer] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<
    "online" | "offline" | null
  >(null);
  const [githubPat, setGithubPat] = useState("");
  const [savingPat, setSavingPat] = useState(false);
  const [aiProvider, setAiProvider] = useState("OpenAI");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [savingAi, setSavingAi] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<
    "idle" | "testing" | "connected" | "failed"
  >("idle");
  const [aiTestError, setAiTestError] = useState("");
  const [aiTestTime, setAiTestTime] = useState<string | null>(null);
  const [githubModels, setGithubModels] = useState<GitHubModelCatalogItem[]>(
    [],
  );
  const [loadingGithubModels, setLoadingGithubModels] = useState(false);
  const [githubModelsError, setGithubModelsError] = useState("");

  const avatarUrl = user?.user_metadata?.avatar_url;
  const username =
    user?.user_metadata?.user_name ?? user?.email?.split("@")[0] ?? "User";
  const backendConfig = getBackendConfig();

  // Initialize from settings
  useEffect(() => {
    if (settings.renderer_provider)
      setRendererProvider(settings.renderer_provider);
    if (settings.renderer_url) setRenderUrl(settings.renderer_url);
    if (settings.renderer_secret) setRenderSecret(settings.renderer_secret);
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
      toast.success("GitHub token saved");
    } catch {
      toast.error("Failed to save GitHub token");
    }
    setSavingPat(false);
  };

  const isGitHubModelsSelected =
    aiProvider === GITHUB_MODELS_PROVIDER ||
    aiBaseUrl.replace(/\/+$/, "") === GITHUB_MODELS_BASE_URL;

  const fetchGitHubModels = async () => {
    if (!aiApiKey && !settings.ai_api_key) {
      toast.error("Enter or save a GitHub token with models:read first");
      return;
    }

    setLoadingGithubModels(true);
    setGithubModelsError("");
    try {
      const result = await callTool("github_models_catalog", {
        token: aiApiKey || undefined,
      });
      const text = result.content.map((item) => item.text ?? "").join("\n");
      if (result.isError) {
        throw new Error(text || "Failed to fetch GitHub Models catalog");
      }

      const data = JSON.parse(text) as GitHubModelCatalogItem[];
      setGithubModels(data);
      if (!aiModel && data[0]?.id) setAiModel(data[0].id);
      toast.success(`Loaded ${data.length} GitHub models`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch GitHub Models catalog";
      setGithubModelsError(message);
      toast.error(message);
    } finally {
      setLoadingGithubModels(false);
    }
  };

  const testAiConnection = async () => {
    setAiTestStatus("testing");
    setAiTestError("");
    try {
      const result = await callTool("test_ai_provider", {});
      if (result.isError) {
        setAiTestStatus("failed");
        setAiTestError(
          result.content.map((item) => item.text ?? "").join("\n") ||
            "AI provider test failed",
        );
        return;
      }
      setAiTestStatus("connected");
      setAiTestTime(new Date().toLocaleTimeString());
    } catch (error) {
      setAiTestStatus("failed");
      setAiTestError(
        error instanceof Error ? error.message : "AI provider test failed",
      );
    }
  };

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      await upsert.mutateAsync({ key: "ai_provider", value: aiProvider });
      await upsert.mutateAsync({ key: "ai_base_url", value: aiBaseUrl });
      await upsert.mutateAsync({ key: "ai_api_key", value: aiApiKey });
      await upsert.mutateAsync({ key: "ai_model", value: aiModel });
      toast.success("AI provider config saved");
      // Auto-test through backend after save so the browser does not call provider APIs directly.
      await testAiConnection();
    } catch {
      toast.error("Failed to save AI config");
    }
    setSavingAi(false);
  };

  const handleSaveRenderer = async () => {
    setSavingRenderer(true);
    try {
      await upsert.mutateAsync({
        key: "renderer_provider",
        value: rendererProvider,
      });
      await upsert.mutateAsync({ key: "renderer_url", value: renderUrl });
      await upsert.mutateAsync({ key: "renderer_secret", value: renderSecret });
      // Keep legacy key in sync for backward compat
      await upsert.mutateAsync({
        key: "renderer_enabled",
        value: rendererProvider !== "none" ? "true" : "false",
      });
      toast.success("Renderer config saved");
    } catch {
      toast.error("Failed to save");
    }
    setSavingRenderer(false);
  };

  const handleTestRenderer = async () => {
    setTestingRenderer(true);
    setRendererStatus(null);
    try {
      if (rendererProvider === "browserless" || rendererProvider === "custom") {
        // Test via MCP scrape_js tool which uses the saved renderer settings
        const result = await callTool("scrape_js", {
          url: "https://example.com",
          waitFor: 3000,
        });
        if (result.isError) {
          setRendererStatus("offline");
        } else {
          setRendererStatus("online");
        }
      } else {
        setRendererStatus("offline");
      }
    } catch {
      setRendererStatus("offline");
    }
    setTestingRenderer(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
        SETTINGS
      </h1>

      {/* Hosted Backend */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">
          Hosted Backend
        </h2>
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Mode</span>
            <StatusBadge status="online" label="HOSTED" />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            Supabase: {backendConfig.supabaseUrl}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            MCP: {backendConfig.mcpEndpoint}
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          All users connect to the hosted Firecrawl KW Supabase backend.
          Generate per-user MCP secrets from the MCP Secrets page; users do not
          need to configure their own Supabase project.
        </p>
      </GlassCard>

      {/* GitHub OAuth Status */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">
          GitHub Authentication
        </h2>
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="bg-muted font-mono">
              {username[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium text-sm">{username}</p>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status="online" label="CONNECTED" />
              {githubToken ? (
                <StatusBadge status="success" label="GITHUB TOKEN" />
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
                  <p className="text-xs text-cyber-amber font-medium">
                    GitHub token not available
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Re-authenticate if you need GitHub profile access in this
                    dashboard.
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
                  Refresh your GitHub dashboard login token. GitHub Models uses
                  a separate token with models:read.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 w-full sm:w-auto"
                onClick={() => {
                  const origin =
                    window.top?.location.origin || window.location.origin;
                  const url = `${getBackendConfig().supabaseUrl}/functions/v1/github-auth?redirect_uri=${encodeURIComponent(origin)}&scope=${encodeURIComponent("read:user user:email")}`;
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

      {/* MCP API Protection */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-primary" />
          MCP Server Auth
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          The web dashboard authenticates with your Supabase session. Each user
          can generate personal MCP secrets from the MCP Secrets page; those
          secrets are sent by local MCP clients as{" "}
          <code className="text-primary">X-MCP-Secret</code>.
        </p>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            There is no shared backend secret. Use per-user MCP secrets so
            access can be created, renamed, revoked, and deleted from the
            website per logged-in account.
          </p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">
          GitHub Models Access
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          GitHub Models is separate from Copilot. To use GitHub-hosted models as
          an AI provider, create a fine-grained token or GitHub App token with{" "}
          <code className="text-primary">models:read</code>, then use it as the
          AI Provider API key. This is rate-limited and not unlimited free
          usage.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">
              GitHub PAT
            </Label>
            <Input
              type="password"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder="GitHub token with models:read"
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
              {savingPat ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3" />
              )}
              Save GitHub Token
            </Button>
            {settings.github_pat && (
              <StatusBadge status="success" label="TOKEN SAVED" />
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
              {AI_PROVIDERS.find((p) => p.label === settings.ai_provider)
                ?.icon ?? "🔌"}{" "}
              {settings.ai_provider}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Select a provider or choose "OpenAI Compatible" to enter a custom
          endpoint.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">
              Provider
            </Label>
            <Select value={aiProvider} onValueChange={handleSelectProvider}>
              <SelectTrigger className="font-mono text-sm bg-background/50 border-primary/30 focus:ring-primary/50 shadow-[0_0_6px_hsl(var(--primary)/0.1)]">
                <SelectValue placeholder="Select provider…" />
              </SelectTrigger>
              <SelectContent className="max-h-64 bg-card border-primary/20">
                {AI_PROVIDERS.map((p) => (
                  <SelectItem
                    key={p.label}
                    value={p.label}
                    className="font-mono text-sm"
                  >
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
            <Label className="text-xs font-mono text-muted-foreground">
              Base URL
            </Label>
            <Input
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-sm bg-background/50 border-border"
            />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">
              API Key
            </Label>
            <Input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={
                isGitHubModelsSelected
                  ? "GitHub token with models:read"
                  : "sk-..."
              }
              className="font-mono text-sm bg-background/50 border-border"
            />
            {isGitHubModelsSelected && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Use a fine-grained GitHub token or GitHub App token with{" "}
                <code className="text-primary">models:read</code>. GitHub Models
                is not the same as Copilot and is rate-limited.
              </p>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label className="text-xs font-mono text-muted-foreground">
                Model
              </Label>
              {isGitHubModelsSelected && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchGitHubModels}
                  disabled={!aiApiKey || loadingGithubModels}
                  className="h-7 text-[10px] font-mono border-border gap-1.5"
                >
                  {loadingGithubModels ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Fetch Models
                </Button>
              )}
            </div>
            {isGitHubModelsSelected && githubModels.length > 0 ? (
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger className="font-mono text-sm bg-background/50 border-border">
                  <SelectValue placeholder="Select GitHub model…" />
                </SelectTrigger>
                <SelectContent className="max-h-72 bg-card border-primary/20">
                  {githubModels.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      className="font-mono text-xs"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span>{model.id}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {[
                            model.publisher,
                            model.rate_limit_tier
                              ? `${model.rate_limit_tier} tier`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder={
                  isGitHubModelsSelected ? "openai/gpt-4.1" : "gpt-4o-mini"
                }
                className="font-mono text-sm bg-background/50 border-border"
              />
            )}
            {githubModelsError && isGitHubModelsSelected && (
              <p className="mt-1.5 text-[10px] text-destructive font-mono">
                {githubModelsError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveAi}
              disabled={!aiApiKey || savingAi}
              className="text-xs font-mono border-primary/30 gap-1.5 hover:bg-primary/10 hover:border-primary/50"
            >
              {savingAi ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3" />
              )}
              Save & Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testAiConnection()}
              disabled={!settings.ai_api_key || aiTestStatus === "testing"}
              className="text-xs font-mono border-border gap-1.5"
            >
              {aiTestStatus === "testing" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              Test
            </Button>
            {aiTestStatus === "connected" && (
              <StatusBadge status="success" label="CONNECTED" />
            )}
            {aiTestStatus === "failed" && (
              <StatusBadge status="error" label="FAILED" />
            )}
            {aiTestStatus === "testing" && (
              <StatusBadge status="pending" label="TESTING…" pulse />
            )}
            {settings.ai_api_key && aiTestStatus === "idle" && (
              <StatusBadge status="success" label="CONFIGURED" />
            )}
          </div>
          {aiTestStatus === "failed" && aiTestError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 mt-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive font-mono">
                  {aiTestError}
                </p>
              </div>
            </div>
          )}
          {aiTestStatus === "connected" && aiTestTime && (
            <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1 mt-1.5">
              <Clock className="h-2.5 w-2.5" /> Last verified {aiTestTime}
            </p>
          )}
        </div>
      </GlassCard>

      {/* JS Renderer */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold">
            JS Renderer
          </h2>
          {rendererProvider !== "none" && (
            <StatusBadge
              status="online"
              label={rendererProvider.toUpperCase()}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Enables <code className="text-primary">scrape_js</code> and{" "}
          <code className="text-primary">screenshot</code> tools. Without a
          renderer, scrape_js falls back to plain HTTP scrape.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">
              Provider
            </Label>
            <Select
              value={rendererProvider}
              onValueChange={setRendererProvider}
            >
              <SelectTrigger className="font-mono text-sm bg-background/50 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="none" className="text-xs font-mono">
                  None (fallback to plain scrape)
                </SelectItem>
                <SelectItem value="browserless" className="text-xs font-mono">
                  Browserless.io
                </SelectItem>
                <SelectItem value="custom" className="text-xs font-mono">
                  Custom Renderer
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rendererProvider === "browserless" && (
            <>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  Browserless URL (optional, defaults to chrome.browserless.io)
                </Label>
                <Input
                  value={renderUrl}
                  onChange={(e) => setRenderUrl(e.target.value)}
                  placeholder="https://production-sfo.browserless.io"
                  className="font-mono text-sm bg-background/50 border-border"
                />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  API Token
                </Label>
                <Input
                  type="password"
                  value={renderSecret}
                  onChange={(e) => setRenderSecret(e.target.value)}
                  placeholder="Your Browserless API token"
                  className="font-mono text-sm bg-background/50 border-border"
                />
              </div>
            </>
          )}
          {rendererProvider === "custom" && (
            <>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  Renderer URL
                </Label>
                <Input
                  value={renderUrl}
                  onChange={(e) => setRenderUrl(e.target.value)}
                  placeholder="https://your-renderer.fly.dev"
                  className="font-mono text-sm bg-background/50 border-border"
                />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  Secret (optional)
                </Label>
                <Input
                  type="password"
                  value={renderSecret}
                  onChange={(e) => setRenderSecret(e.target.value)}
                  placeholder="Optional shared secret"
                  className="font-mono text-sm bg-background/50 border-border"
                />
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveRenderer}
              disabled={savingRenderer}
              className="text-xs font-mono border-border gap-1.5"
            >
              {savingRenderer ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3" />
              )}
              Save
            </Button>
            {rendererProvider !== "none" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestRenderer}
                disabled={testingRenderer}
                className="text-xs font-mono border-border gap-1.5"
              >
                {testingRenderer ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Test Connection
              </Button>
            )}
            {rendererStatus && (
              <StatusBadge
                status={rendererStatus === "online" ? "success" : "error"}
                label={rendererStatus === "online" ? "CONNECTED" : "ERROR"}
              />
            )}
          </div>
        </div>
      </GlassCard>

      {/* Danger Zone */}
      <GlassCard className="border-destructive/30">
        <h2 className="text-xs font-mono uppercase tracking-widest text-destructive mb-4 font-semibold">
          Danger Zone
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Clear all request logs</p>
            <p className="text-xs text-muted-foreground">
              This action cannot be undone.
            </p>
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
