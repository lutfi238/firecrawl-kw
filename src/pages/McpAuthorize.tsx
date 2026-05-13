import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface OAuthParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  authorize_endpoint: string;
}

export default function McpAuthorize() {
  const params = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    const out: OAuthParams = {
      client_id: sp.get("client_id") || "",
      redirect_uri: sp.get("redirect_uri") || "",
      state: sp.get("state") || "",
      code_challenge: sp.get("code_challenge") || "",
      code_challenge_method: sp.get("code_challenge_method") || "plain",
      scope: sp.get("scope") || "mcp",
      authorize_endpoint: sp.get("authorize_endpoint") || "",
    };
    return out;
  }, []);

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.client_id || !params.redirect_uri || !params.authorize_endpoint) {
      setError(
        "Missing OAuth parameters. Open this page from Claude Web's Connect flow.",
      );
    }
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError("");

    try {
      const form = new URLSearchParams();
      form.set("client_id", params.client_id);
      form.set("redirect_uri", params.redirect_uri);
      form.set("state", params.state);
      form.set("code_challenge", params.code_challenge);
      form.set("code_challenge_method", params.code_challenge_method);
      form.set("scope", params.scope);
      form.set("password", password);
      form.set("response_format", "json");

      const res = await fetch(params.authorize_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          body?.error === "invalid_password"
            ? "Wrong master password."
            : body?.error_description ||
              body?.error ||
              `Authorization failed (${res.status})`;
        setError(message);
        toast.error(message);
        return;
      }

      const data = (await res.json()) as { redirect?: string };
      if (!data.redirect) {
        throw new Error("Authorization server did not return a redirect URL");
      }

      toast.success("Authorized. Returning to Claude…");
      window.location.href = data.redirect;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authorization failed";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background dot-grid p-4">
      <div className="glass rounded-xl p-8 max-w-sm w-full flex flex-col gap-5">
        <div className="flex items-center gap-2 text-primary">
          <Lock className="h-4 w-4" />
          <h1 className="font-display text-lg font-bold tracking-widest text-gradient-cyber">
            AUTHORIZE MCP CONNECTOR
          </h1>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          A remote MCP client is requesting access to your Firecrawl MCP server.
          Enter the master password configured on the server to approve.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Master Password
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              disabled={loading || !params.authorize_endpoint}
              className="font-mono bg-background/50 border-border"
              placeholder="MCP_MASTER_PASSWORD"
            />
          </div>

          {error && (
            <p className="text-[11px] font-mono text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !password || !params.authorize_endpoint}
            className="w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            Authorize
          </Button>
        </form>

        <div className="space-y-1 text-[10px] font-mono text-muted-foreground/70 break-all">
          <p>
            Client:{" "}
            <span className="text-foreground">
              {params.client_id || "<missing>"}
            </span>
          </p>
          <p>
            Redirect:{" "}
            <span className="text-foreground">
              {params.redirect_uri || "<missing>"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
