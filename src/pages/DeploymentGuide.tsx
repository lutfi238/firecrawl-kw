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
  const mcpEndpoint =
    backend.mcpEndpoint ||
    "https://<project-ref>.supabase.co/functions/v1/mcp-server";
  const localProxyPath =
    "D:/Project_Gabut/firecrawl-kw/scripts/mcp-stdio-proxy.mjs";
  const stdioEnv = {
    MCP_ENDPOINT: mcpEndpoint,
    MCP_SECRET: "<value-of-MCP_SECRET>",
    SUPABASE_ANON_KEY: "<optional-supabase-anon-key>",
    GITHUB_TOKEN: "<optional-github-token-for-github-tools>",
  };
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        "firecrawl-kw": {
          command: "node",
          args: [localProxyPath],
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
          command: "node",
          args: [localProxyPath],
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
        command: "node",
        args: [localProxyPath],
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
          4. MCP client configuration
        </h2>
        <div className="space-y-4 text-sm text-muted-foreground">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
            Use <span className="font-mono text-foreground">remote OAuth</span>{" "}
            for Claude Web. Use the local{" "}
            <span className="font-mono text-foreground">stdio proxy</span> for
            editors that only launch local MCP processes, such as VS Code, Zed,
            Claude Desktop, Cursor, and many MCP plugins. Keep secrets in local
            client config or Supabase secrets, never in browser-visible Vite env
            vars.
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
              top-level map of server names. Adjust the script path to wherever
              you cloned this repository.
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
                your deployed Supabase MCP function URL.
              </li>
              <li>
                <span className="font-mono text-foreground">MCP_SECRET</span>:
                legacy/local-client secret used by the stdio proxy. Required for
                stdio configs unless you provide a valid bearer token instead.
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
