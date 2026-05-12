import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { getBackendConfig } from "@/lib/backendConfig";
import { Copy, ExternalLink, Rocket } from "lucide-react";
import { toast } from "sonner";

const projectRef = "<your-project-ref>";

const commands = [
  `supabase link --project-ref ${projectRef}`,
  "supabase db push",
  "supabase functions deploy mcp-server",
  "supabase functions deploy github-auth",
  "supabase functions deploy mcp-logs",
  "supabase functions deploy mcp-jobs",
  "supabase functions deploy uptime-checker",
  'supabase secrets set MCP_SECRET="<new-random-legacy-mcp-secret>"',
  'supabase secrets set MCP_MASTER_PASSWORD="<new-random-consent-password>"',
  'supabase secrets set CLAUDE_OAUTH_CLIENT_ID="firecrawl-kw-claude"',
  'supabase secrets set CLAUDE_OAUTH_CLIENT_SECRET="<new-random-client-secret>"',
];

function CommandBlock({ lines }: { lines: string[] }) {
  const text = lines.join("\n");
  return (
    <div className="relative rounded-lg border border-border bg-background/60 p-4">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={() => {
          navigator.clipboard.writeText(text);
          toast.success("Commands copied");
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <pre className="overflow-x-auto pr-8 text-xs text-muted-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function DeploymentGuide() {
  const backend = getBackendConfig();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-wider text-gradient-cyber">
          DEPLOYMENT GUIDE
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use this checklist to deploy your own Supabase backend and connect
          this hosted UI to resources you own.
        </p>
      </div>

      <GlassCard>
        <div className="mb-4 flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
            Architecture reminder
          </h2>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Lovable/GitHub deploys the React frontend. Supabase deploys the MCP
            backend Edge Functions, database, logs, jobs, OAuth tables, and
            secrets.
          </p>
          <p>
            GitHub push alone updates the UI, but backend changes still need
            Supabase CLI deploy commands.
          </p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          1. Create and link Supabase
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Create a Supabase project in your own account.</li>
          <li>Copy the project ref from the dashboard URL.</li>
          <li>
            You already installed/logged into Supabase CLI, so link the repo to
            the project.
          </li>
        </ol>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          2. Deploy database, functions, and secrets
        </h2>
        <CommandBlock lines={commands} />
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          3. Configure frontend backend connection
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          In Settings → Backend Connection → Reconfigure Backend, paste your own
          values:
        </p>
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-3 text-xs font-mono text-muted-foreground">
          <p>Supabase URL: https://&lt;project-ref&gt;.supabase.co</p>
          <p>Supabase anon key: from Project Settings → API</p>
          <p>
            MCP URL:
            https://&lt;project-ref&gt;.supabase.co/functions/v1/mcp-server
          </p>
        </div>
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          Never paste your Supabase service-role key into the frontend. Only use
          the browser-safe anon/publishable key.
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          4. Claude Web connector
        </h2>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Remote MCP server URL:</p>
          <code className="block rounded border border-border bg-background/50 p-2 text-xs">
            {backend.mcpEndpoint ||
              "https://<project-ref>.supabase.co/functions/v1/mcp-server"}
          </code>
          <p>
            OAuth Client ID: value of `CLAUDE_OAUTH_CLIENT_ID`, for example
            `firecrawl-kw-claude`.
          </p>
          <p>OAuth Client Secret: value of `CLAUDE_OAUTH_CLIENT_SECRET`.</p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          5. Health checks
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Open the MCP URL in a browser and expect JSON with status `ok`.
          </li>
          <li>
            Open `.well-known/oauth-protected-resource` under the MCP URL.
          </li>
          <li>In this UI, verify the server status shows online.</li>
          <li>Use Tool Tester → `search` for a simple web search.</li>
          <li>
            Check Supabase Edge Function logs for `[mcp] initialize` and `[mcp]
            tools/call` when Claude connects.
          </li>
        </ul>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          References
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://supabase.com/docs/guides/functions"
              target="_blank"
              rel="noreferrer"
            >
              Supabase Edge Functions{" "}
              <ExternalLink className="ml-1.5 h-3 w-3" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://docs.github.com/en/rest/models"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Models <ExternalLink className="ml-1.5 h-3 w-3" />
            </a>
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
