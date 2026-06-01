import { useState } from "react";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Globe,
  Search,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { getBackendConfig } from "@/lib/backendConfig";
import { useAuthStore } from "@/stores/authStore";

type EndpointType = "fetch" | "search";

interface FetchResponse {
  success: boolean;
  data?: {
    url?: string;
    format?: string;
    markdown?: string;
    html?: string;
    content?: string;
    metadata?: {
      contentLength: number;
      truncated: boolean;
    };
  };
  error?: string;
}

interface SearchResponse {
  success: boolean;
  data?: {
    query: string;
    search_type: string;
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      searchSource?: string;
    }>;
    count: number;
  };
  error?: string;
}

export default function APITester() {
  const { user } = useAuthStore();
  const [endpoint, setEndpoint] = useState<EndpointType>("fetch");
  const [apiKey, setApiKey] = useState("");
  const [url, setUrl] = useState("https://example.com");
  const [format, setFormat] = useState("markdown");
  const [maxChars, setMaxChars] = useState("0");
  const [jsEnabled, setJsEnabled] = useState(false);
  const [waitFor, setWaitFor] = useState("3000");
  const [query, setQuery] = useState("latest AI news");
  const [maxResults, setMaxResults] = useState("5");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string>("");
  const [responseStatus, setResponseStatus] = useState<
    "success" | "error" | null
  >(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);

  const backendConfig = getBackendConfig();
  const baseUrl = backendConfig.mcpEndpoint || "";

  const fetchEndpoint = baseUrl
    ? `${baseUrl}/v1/web/fetch`
    : "https://<project>.supabase.co/functions/v1/mcp-server/v1/web/fetch";
  const searchEndpoint = baseUrl
    ? `${baseUrl}/v1/search`
    : "https://<project>.supabase.co/functions/v1/mcp-server/v1/search";
  const currentEndpoint = endpoint === "fetch" ? fetchEndpoint : searchEndpoint;

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 7)}${"•".repeat(Math.max(0, apiKey.length - 7))}`
    : "";

  const isMcpSecret =
    apiKey.startsWith("firecrawl-") ||
    apiKey.startsWith("sk-") ||
    apiKey.length > 20;
  const authHeaderName = isMcpSecret ? "X-MCP-Secret" : "Authorization: Bearer";

  const generateCurl = (): string => {
    const authHeader = apiKey
      ? `  -H "${authHeaderName}: ***" \\`
      : "  # Add your API key";
    const contentType = '  -H "Content-Type: application/json" \\';

    if (endpoint === "fetch") {
      const body = JSON.stringify(
        {
          url,
          format: format !== "markdown" ? format : undefined,
          max_characters: parseInt(maxChars) || 0,
          js: jsEnabled || undefined,
          waitFor: jsEnabled ? parseInt(waitFor) || 3000 : undefined,
        },
        null,
        2,
      );

      return `curl -X POST ${fetchEndpoint} \\
${contentType}
${authHeader}
  -d '${body.replace(/'/g, "'\\''")}'`;
    } else {
      const body = JSON.stringify(
        {
          query,
          max_results: parseInt(maxResults) || 5,
        },
        null,
        2,
      );

      return `curl -X POST ${searchEndpoint} \\
${contentType}
${authHeader}
  -d '${body.replace(/'/g, "'\\''")}'`;
    }
  };

  const copyCurl = async () => {
    await navigator.clipboard.writeText(generateCurl());
    toast.success("Curl command copied!");
  };

  const execute = async () => {
    if (!apiKey) {
      toast.error(
        "API key is required. Use your Supabase session token or a per-user MCP secret.",
      );
      return;
    }

    setLoading(true);
    setResponse("");
    setResponseStatus(null);
    setResponseTime(null);

    const startedAt = Date.now();

    try {
      let body: Record<string, unknown>;
      let targetUrl: string;

      if (endpoint === "fetch") {
        if (!url) {
          toast.error("URL is required");
          setLoading(false);
          return;
        }
        targetUrl = fetchEndpoint;
        body = {
          url,
          format: format !== "markdown" ? format : "markdown",
          max_characters: parseInt(maxChars) || 0,
        };
        if (jsEnabled) {
          body.js = true;
          body.waitFor = parseInt(waitFor) || 3000;
        }
      } else {
        if (!query) {
          toast.error("Query is required");
          setLoading(false);
          return;
        }
        targetUrl = searchEndpoint;
        body = {
          query,
          max_results: parseInt(maxResults) || 5,
        };
      }

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: isMcpSecret
          ? {
              "Content-Type": "application/json",
              "X-MCP-Secret": apiKey,
            }
          : {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
        body: JSON.stringify(body),
      });

      const elapsed = Date.now() - startedAt;
      setResponseTime(elapsed);

      const data = await res.text();
      let formatted: string;

      try {
        const parsed = JSON.parse(data);
        formatted = JSON.stringify(parsed, null, 2);
      } catch {
        formatted = data;
      }

      setResponse(formatted);

      if (res.ok) {
        setResponseStatus("success");
        try {
          const parsed = JSON.parse(data);
          if (parsed.success === false) {
            setResponseStatus("error");
          }
        } catch {
          // not JSON, treat as success if HTTP ok
        }
      } else {
        setResponseStatus("error");
      }
    } catch (err) {
      setResponseTime(Date.now() - startedAt);
      setResponseStatus("error");
      setResponse(
        JSON.stringify(
          {
            error: err instanceof Error ? err.message : "Unknown error",
            hint: "Make sure the Supabase Edge Function is deployed and the API key is correct.",
          },
          null,
          2,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const clearResponse = () => {
    setResponse("");
    setResponseStatus(null);
    setResponseTime(null);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
          API TESTER
        </h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            REST API
          </Badge>
        </div>
      </div>

      {/* Endpoint Selection */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">
          Endpoint
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setEndpoint("fetch")}
            className={`flex items-center gap-3 rounded-lg border p-4 transition-all ${
              endpoint === "fetch"
                ? "border-primary/50 bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.15)]"
                : "border-border bg-background/40 hover:border-primary/30"
            }`}
          >
            <Globe className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-mono text-sm font-semibold">/v1/web/fetch</p>
              <p className="text-xs text-muted-foreground">Scrape any URL</p>
            </div>
          </button>
          <button
            onClick={() => setEndpoint("search")}
            className={`flex items-center gap-3 rounded-lg border p-4 transition-all ${
              endpoint === "search"
                ? "border-primary/50 bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.15)]"
                : "border-border bg-background/40 hover:border-primary/30"
            }`}
          >
            <Search className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-mono text-sm font-semibold">/v1/search</p>
              <p className="text-xs text-muted-foreground">Search the web</p>
            </div>
          </button>
        </div>
      </GlassCard>

      {/* API Key */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold">
          Authentication
        </h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">
              API Key
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Supabase session token or MCP secret"
              className="font-mono text-sm bg-background/50 border-border"
            />
            {maskedKey && (
              <p className="mt-1 text-[10px] text-muted-foreground font-mono">
                Key: {maskedKey}
              </p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Parameters */}
      <GlassCard>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 font-semibold flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          Parameters
        </h2>

        {endpoint === "fetch" ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-mono text-muted-foreground">
                URL *
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="font-mono text-sm bg-background/50 border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  Format
                </Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="font-mono text-sm bg-background/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="markdown" className="font-mono text-xs">
                      markdown
                    </SelectItem>
                    <SelectItem value="html" className="font-mono text-xs">
                      html
                    </SelectItem>
                    <SelectItem value="raw" className="font-mono text-xs">
                      raw
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">
                  Max chars
                </Label>
                <Input
                  type="number"
                  value={maxChars}
                  onChange={(e) => setMaxChars(e.target.value)}
                  placeholder="0 = unlimited"
                  className="font-mono text-sm bg-background/50 border-border"
                />
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono text-muted-foreground">
                  JS Renderer
                </Label>
                <button
                  onClick={() => setJsEnabled(!jsEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    jsEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      jsEnabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              {jsEnabled && (
                <div>
                  <Label className="text-xs font-mono text-muted-foreground">
                    Wait (ms)
                  </Label>
                  <Input
                    type="number"
                    value={waitFor}
                    onChange={(e) => setWaitFor(e.target.value)}
                    placeholder="3000"
                    className="font-mono text-sm bg-background/50 border-border"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-mono text-muted-foreground">
                Query *
              </Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="latest AI news"
                className="font-mono text-sm bg-background/50 border-border"
              />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">
                Max results
              </Label>
              <Input
                type="number"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                placeholder="5"
                className="font-mono text-sm bg-background/50 border-border"
              />
            </div>
          </div>
        )}
      </GlassCard>

      {/* Curl Command */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold">
            Curl Command
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={copyCurl}
            className="text-xs font-mono border-border gap-1.5"
          >
            <Copy className="h-3 w-3" /> Copy
          </Button>
        </div>
        <pre className="rounded-md border border-border bg-black/50 p-3 overflow-x-auto">
          <code className="text-xs font-mono text-green-400 whitespace-pre-wrap break-all">
            {generateCurl()}
          </code>
        </pre>
      </GlassCard>

      {/* Execute Button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={execute}
          disabled={loading}
          className="gap-2 font-mono bg-primary/90 hover:bg-primary"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {loading ? "Executing..." : "Execute"}
        </Button>
        {response && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearResponse}
            className="text-xs font-mono border-border"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Response */}
      {response && (
        <GlassCard>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold">
                Response
              </h2>
              {responseStatus === "success" && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 font-mono text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" /> 200 OK
                </Badge>
              )}
              {responseStatus === "error" && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 font-mono text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" /> Error
                </Badge>
              )}
            </div>
            {responseTime !== null && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {responseTime}ms
              </span>
            )}
          </div>

          {responseStatus === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-destructive font-medium">
                    Request failed
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {responseStatus === "error" && !response.includes("success")
                      ? "HTTP error — check API key and endpoint URL."
                      : "The server responded but returned an error. See details below."}
                  </p>
                </div>
              </div>
            </div>
          )}

          <pre className="rounded-md border border-border bg-black/50 p-3 overflow-x-auto max-h-[500px] overflow-y-auto">
            <code
              className={`text-xs font-mono whitespace-pre-wrap break-all ${
                responseStatus === "error" ? "text-red-400" : "text-green-400"
              }`}
            >
              {response}
            </code>
          </pre>
        </GlassCard>
      )}

      {/* Info */}
      <GlassCard className="border-cyber-amber/30">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-cyber-amber mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-xs text-cyber-amber font-medium">Info</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 font-mono">
              <li>
                • API Key: gunakan Supabase session token atau MCP secret dari
                halaman MCP Secrets
              </li>
              <li>
                • Session token: buka DevTools → Application → LocalStorage →{" "}
                <code className="text-primary">supabase.auth.token</code> → copy{" "}
                <code className="text-primary">access_token</code>
              </li>
              <li>
                • Endpoint Supabase:{" "}
                <code className="text-primary">
                  https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server
                </code>
              </li>
              <li>
                • REST API memerlukan Supabase Edge Function sudah di-deploy
              </li>
            </ul>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
