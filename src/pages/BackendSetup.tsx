import { useState } from "react";
import { clearBackendConfig, deriveMcpEndpoint, getBackendConfig, getEnvBackendConfig, hasValidBackendConfig, saveBackendConfig } from "@/lib/backendConfig";
import { resetSupabaseClientCache } from "@/lib/supabaseRuntime";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, Loader2, RotateCcw, Server } from "lucide-react";
import { toast } from "sonner";

interface BackendSetupProps {
  onConfigured: () => void;
}

export default function BackendSetup({ onConfigured }: BackendSetupProps) {
  const initial = getBackendConfig();
  const envConfig = getEnvBackendConfig();
  const [supabaseUrl, setSupabaseUrl] = useState(initial.supabaseUrl);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(initial.supabaseAnonKey);
  const [mcpEndpoint, setMcpEndpoint] = useState(initial.mcpEndpoint);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "failed">("idle");
  const [testError, setTestError] = useState("");

  const handleSupabaseUrlChange = (value: string) => {
    setSupabaseUrl(value);
    setMcpEndpoint(deriveMcpEndpoint(value));
  };

  const testBackend = async () => {
    setTesting(true);
    setTestStatus("idle");
    setTestError("");
    try {
      const res = await fetch(mcpEndpoint, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`MCP health returned HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data?.status) throw new Error("MCP health response did not include status");
      setTestStatus("success");
      toast.success("Backend connection works");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backend test failed";
      setTestStatus("failed");
      setTestError(message);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const saveCustom = () => {
    const saved = saveBackendConfig({ supabaseUrl, supabaseAnonKey, mcpEndpoint });
    if (!hasValidBackendConfig(saved)) {
      toast.error("Backend config is incomplete or invalid");
      return;
    }
    resetSupabaseClientCache();
    toast.success("Custom backend saved");
    onConfigured();
  };

  const useDefault = () => {
    clearBackendConfig();
    resetSupabaseClientCache();
    toast.success("Using default backend");
    onConfigured();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background dot-grid p-4">
      <GlassCard className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">BACKEND SETUP</h1>
            <p className="text-xs text-muted-foreground">Use the default personal backend or connect your own Supabase/MCP deployment.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Supabase URL</Label>
            <Input value={supabaseUrl} onChange={(event) => handleSupabaseUrlChange(event.target.value)} placeholder="https://project-ref.supabase.co" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Supabase Publishable / Anon Key</Label>
            <Input type="password" value={supabaseAnonKey} onChange={(event) => setSupabaseAnonKey(event.target.value)} placeholder="eyJ..." className="font-mono text-sm" />
            <p className="mt-1 text-[10px] text-muted-foreground">Never enter a service-role key here. Only the browser-safe anon/publishable key belongs in this field.</p>
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">MCP Server URL</Label>
            <Input value={mcpEndpoint} onChange={(event) => setMcpEndpoint(event.target.value)} placeholder="https://project-ref.supabase.co/functions/v1/mcp-server" className="font-mono text-sm" />
          </div>

          {testStatus === "success" && (
            <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3 text-xs text-green-400">
              <CheckCircle className="mt-0.5 h-4 w-4" /> MCP health check succeeded.
            </div>
          )}
          {testStatus === "failed" && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" /> {testError}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={saveCustom} disabled={!supabaseUrl || !supabaseAnonKey || !mcpEndpoint} className="flex-1 gap-1.5">
              <CheckCircle className="h-4 w-4" /> Save Custom Backend
            </Button>
            <Button variant="outline" onClick={testBackend} disabled={!mcpEndpoint || testing} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />} Test
            </Button>
            <Button variant="outline" onClick={useDefault} disabled={!envConfig.supabaseUrl || !envConfig.supabaseAnonKey} className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> Default
            </Button>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              For personal use, the default backend can be your Lovable/Supabase deployment. For bring-your-own mode, deploy the Supabase migrations/functions in your own Supabase project, then paste that project’s URL, anon key, and MCP endpoint here.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
