import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { getBackendConfig } from "@/lib/backendConfig";
import { Copy, ExternalLink, Rocket } from "lucide-react";
import { toast } from "sonner";

const projectRef = "azegdjbrznxdhyeaztqm";

const commands = [
  `supabase link --project-ref ${projectRef}`,
  "supabase db push",
  "supabase functions deploy mcp-server",
  "supabase functions deploy github-auth",
  "supabase functions deploy mcp-logs",
  "supabase functions deploy mcp-jobs",
  "supabase functions deploy uptime-checker",
  'supabase secrets set MCP_MASTER_PASSWORD="<new-random-consent-password>"',
  'supabase secrets set CLAUDE_OAUTH_CLIENT_ID="firecrawl-kw-claude"',
  'supabase secrets set CLAUDE_OAUTH_CLIENT_SECRET="<new-random-client-secret>"',
];

function copyText(text: string, label = "Copied") {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

function CommandBlock({ lines }: { lines: string[] }) {
  return <ConfigBlock text={lines.join("\n")} copiedLabel="Commands copied" />;
}

function ConfigBlock({
  text,
  copiedLabel = "Configuration copied",
}: {
  text: string;
  copiedLabel?: string;
}) {
  return (
    <div className="relative rounded-lg border border-border bg-background/60 p-4">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={() => copyText(text, copiedLabel)}
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
  const hostedMcpEndpoint =
    "https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server";
  const mcpEndpoint = backend.mcpEndpoint || hostedMcpEndpoint;
  const stdioEnv = {
    MCP_SECRET: "<per-user-secret-from-MCP-Secrets-page>",
  };
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        "firecrawl-kw": {
          command: "npx",
          args: ["-y", "firecrawl-kw-mcp"],
          env: stdioEnv,
        },
      },
    },
    null,
    2,
  );
  const vsCodeConfig = JSON.stringify(
    {
      servers: {
        "firecrawl-kw": {
          type: "stdio",
          command: "npx",
          args: ["-y", "firecrawl-kw-mcp"],
          env: stdioEnv,
        },
      },
    },
    null,
    2,
  );
  const zedConfig = JSON.stringify(
    {
      "firecrawl-kw": {
        command: "npx.cmd",
        args: ["-y", "firecrawl-kw-mcp@latest"],
        env: {
          MCP_STDIO_DEBUG: "true",
          ...stdioEnv,
        },
      },
    },
    null,
    2,
  );
  const genericRemoteOauth = [
    `Remote MCP server URL: ${mcpEndpoint}`,
    "OAuth Client ID: firecrawl-kw-claude",
    "OAuth Client Secret: <value-of-CLAUDE_OAUTH_CLIENT_SECRET>",
    "Authorize password: <value-of-MCP_MASTER_PASSWORD>",
  ].join("\n");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-wider text-gradient-cyber">
          DEPLOYMENT GUIDE
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use this checklist to deploy and connect MCP clients to the hosted
          Firecrawl KW Supabase backend.
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
          1. Hosted backend
        </h2>
        <p className="text-sm text-muted-foreground">
          Normal users use the hosted Firecrawl KW Supabase backend. They do not
          need to create or connect their own Supabase project.
        </p>
        <div className="mt-3 rounded-md border border-border bg-background/40 p-3 text-xs font-mono text-muted-foreground">
          {hostedMcpEndpoint}
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          2. Generate a per-user MCP secret
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Log in to the dashboard with a Supabase Auth account.</li>
          <li>Open the MCP Secrets page.</li>
          <li>Generate a new secret and copy the full `fc_kw-...` value.</li>
          <li>Use that full value as `MCP_SECRET` in local MCP clients.</li>
        </ol>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          3. Admin-only backend deployment commands
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Only the project owner needs these commands when updating the hosted
          Supabase backend.
        </p>
        <CommandBlock lines={commands} />
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          4. MCP client configuration
        </h2>
        <div className="space-y-4 text-sm text-muted-foreground">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
            Use <span className="font-mono text-foreground">remote OAuth</span>{" "}
            for Claude Web. Use the{" "}
            <span className="font-mono text-foreground">firecrawl-kw-mcp</span>{" "}
            npm stdio proxy for editors that launch local MCP processes, such as
            VS Code, Zed, Claude Desktop, Cursor, and many MCP plugins. Keep
            secrets in local client config or generate them from the MCP Secrets
            page, never in browser-visible Vite env vars.
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest text-foreground">
              Claude Web custom connector
            </h3>
            <p>
              Claude Web supports remote MCP OAuth directly. Paste these values
              into Claude Web → Settings → Connectors → Add custom connector.
            </p>
            <ConfigBlock text={genericRemoteOauth} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest text-foreground">
              Claude Code / Claude Desktop / Cursor style config
            </h3>
            <p>
              Use this for clients that accept an{" "}
              <span className="font-mono">mcpServers</span> JSON object. In
              Claude Code, add it through the MCP settings/import flow or create
              the equivalent server with command, args, and env values.
            </p>
            <ConfigBlock text={claudeDesktopConfig} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest text-foreground">
              VS Code MCP config
            </h3>
            <p>
              Put this in your workspace/user MCP config, commonly{" "}
              <span className="font-mono">.vscode/mcp.json</span>, if your VS
              Code MCP integration supports stdio servers.
            </p>
            <ConfigBlock text={vsCodeConfig} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest text-foreground">
              Zed Editor config
            </h3>
            <p>
              Paste this into Zed's MCP server settings where it expects a
              top-level map of server names. The proxy package defaults to the
              hosted Firecrawl KW Supabase endpoint.
            </p>
            <ConfigBlock text={zedConfig} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest text-foreground">
              What each value means
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                <span className="font-mono text-foreground">MCP_ENDPOINT</span>:
                optional override. If omitted, the npm proxy uses the hosted
                Firecrawl KW Supabase MCP endpoint.
              </li>
              <li>
                <span className="font-mono text-foreground">MCP_SECRET</span>:
                per-user MCP secret generated from this website. The stdio proxy
                forwards it as{" "}
                <span className="font-mono text-foreground">X-MCP-Secret</span>.
              </li>
              <li>
                <span className="font-mono text-foreground">
                  CLAUDE_OAUTH_CLIENT_ID / SECRET
                </span>
                : only for remote OAuth clients such as Claude Web.
              </li>
              <li>
                <span className="font-mono text-foreground">
                  MCP_MASTER_PASSWORD
                </span>
                : the password you type on the OAuth consent page when Claude
                Web authorizes the connector.
              </li>
              <li>
                <span className="font-mono text-foreground">GITHUB_TOKEN</span>:
                optional local override for GitHub-backed tools. GitHub Models
                provider tokens are normally saved in Settings.
              </li>
              <li>
                <span className="font-mono text-foreground">
                  SUPABASE_ANON_KEY
                </span>
                : optional helper header for the stdio proxy; safe to use, but
                do not use the service-role key here.
              </li>
            </ul>
          </div>
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
