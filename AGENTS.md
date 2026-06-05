# Repository Guidelines

## Project Overview

Personal Firecrawl MCP is a Vite + React + TypeScript dashboard for running a personal MCP server backed by Supabase. It provides web-intelligence tools for search, scrape, crawl, extraction, screenshots, batch jobs, AI chat, request monitoring, uptime checks, and MCP/API-key management. The backend is Supabase Edge Functions on Deno, centered on `mcp-server`, which exposes MCP JSON-RPC plus supporting REST/OAuth endpoints.

## Architecture & Data Flow

- `src/main.tsx` mounts `src/App.tsx`; `App` wires React Query, routing, auth/session sync, backend health/config checks, layout, and toasters.
- Frontend flow: page in `src/pages/` → feature hook in `src/hooks/` → Supabase client or MCP Edge Function → React Query cache/UI state.
- Auth flow: Supabase Auth feeds `src/stores/authStore.ts`; Zustand is only for small auth/session/GitHub-token state. Server data belongs in TanStack Query.
- MCP transport goes through `src/hooks/useMCPServer.ts`, sending JSON-RPC `tools/call` requests to the Edge Function while preserving headers such as `Authorization`, `X-GitHub-Token`, and `X-MCP-Secret`.
- Backend flow: `supabase/functions/mcp-server/index.ts` handles HTTP/MCP/OAuth routing → auth modules resolve the user → tool schemas/dispatch in `tools/definitions.ts` and `tools/callTool.ts` → logs/jobs/settings are persisted in Supabase.
- Supported auth modes are per-user MCP secrets (`X-MCP-Secret`), Supabase session bearer tokens, and OAuth 2.1 bearer tokens for Claude Web/custom connectors. `supabase/config.toml` sets `verify_jwt = false`, so handler-level auth checks are security-critical.
- Database changes live in `supabase/migrations/`; user data should remain RLS-protected. OAuth tables are intended for service-role access only.

## Key Directories

- `src/pages/` — route-level orchestration (`Overview`, `ToolTester`, `APITester`, `ApiKeysPage`, `RequestMonitor`, `Settings`, `AIChat`, `DeploymentGuide`, `BackendSetup`, `McpAuthorize`).
- `src/components/` — feature UI components; keep `src/components/ui/` generic shadcn/Radix primitives.
- `src/hooks/` — reusable app logic for MCP transport, tool execution, settings, logs, uptime, and Supabase-backed flows.
- `src/lib/` — shared utilities and runtime config such as `utils.ts`, `backendConfig.ts`, `supabaseRuntime.ts`, intent/recency helpers, and capability registries.
- `src/stores/` — Zustand store for auth/session state only.
- `src/types/` — shared MCP/tool contracts; keep aligned with Edge Function request/response shapes.
- `src/integrations/supabase/` — generated Supabase client/types; do not hand-edit.
- `src/test/` — Vitest unit, regression, component, and MCP helper tests.
- `supabase/functions/` — Deno Edge Functions: `mcp-server`, `github-auth`, `mcp-logs`, `mcp-jobs`, `uptime-checker`.
- `supabase/migrations/` — SQL migrations for logs, jobs, OAuth, uptime, API keys, and source cache.
- `packages/firecrawl-kw-mcp/` — npm-style stdio MCP proxy package for MCP clients using `command`/`args`/`env`.
- `scripts/` — local helpers, especially `scripts/mcp-stdio-proxy.mjs` for repo-local MCP stdio testing.

## Development Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server on port 8080
npm run build      # production Vite build
npm run build:dev  # development-mode Vite build
npm run preview    # preview built frontend
npm run lint       # eslint .
npm run test       # vitest run
npm run test:watch # vitest watch mode
npm run mcp:stdio  # local MCP stdio proxy
```

Use the smallest relevant check first: `npm run test` for logic changes, `npm run lint` after TypeScript/React edits, and `npm run build` for route, bundling, or integration changes.

## Code Conventions & Common Patterns

- Use functional React components with typed props. Keep pages orchestration-focused; move reusable behavior into hooks or narrow components.
- Prefer `@/` imports for files under `src/`.
- Styling is Tailwind-first. Match the cyber/glass theme in `tailwind.config.ts` and `src/index.css`; reuse Lucide, shadcn, and Radix patterns before adding new UI patterns.
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Use TanStack Query for remote/server state and cache invalidation. Do not expand Zustand beyond small cross-app client state.
- Access Supabase through `getSupabaseClient()` from `src/lib/supabaseRuntime.ts`; avoid direct imports from generated client files in new code.
- Keep MCP/tool payload contracts synchronized across `src/types/mcp.ts`, `src/types/tools.ts`, frontend callers, and `supabase/functions/mcp-server/tools/`.
- Edge Functions run on Deno/web-standard APIs. Do not introduce Node-only APIs under `supabase/functions/`.
- TypeScript app config is not fully strict; manually review nullability, payload shapes, auth branches, and cross-boundary types.
- Preserve non-blocking GitHub token loading in `src/App.tsx` and custom MCP headers in transport code.
- Prefer existing hooks/components/utilities over new abstractions. Delete obsolete code rather than leaving aliases or TODO placeholders.
- Never commit secrets. Document env var names only, not values.

## Important Files

- `src/App.tsx` — provider tree, routing, auth listener, backend gate, MCP health polling.
- `src/hooks/useMCPServer.ts` — MCP JSON-RPC and streaming client.
- `src/hooks/useToolExecutor.ts` and `src/hooks/useToolExecutorWithActivity.ts` — tool execution, timeout, abort, and activity behavior.
- `src/lib/backendConfig.ts` — Vite env-derived hosted Supabase backend config.
- `src/lib/supabaseRuntime.ts` — runtime Supabase client factory and MCP endpoint helpers.
- `src/lib/intentClassifier.ts`, `src/lib/recency.ts`, `src/lib/visionCapability.ts` — AI chat/tool-routing support logic.
- `src/stores/authStore.ts` — auth/session Zustand store.
- `src/types/mcp.ts` and `src/types/tools.ts` — shared frontend MCP contracts and tool definitions.
- `supabase/functions/mcp-server/index.ts` — main MCP/REST/OAuth HTTP handler.
- `supabase/functions/mcp-server/auth/mcpSecret.ts` and `auth/oauth.ts` — MCP secret, Supabase bearer, and OAuth 2.1 auth resolution.
- `supabase/functions/mcp-server/tools/callTool.ts` and `tools/definitions.ts` — central tool dispatch and dynamic MCP schemas.
- `scripts/mcp-stdio-proxy.mjs` and `packages/firecrawl-kw-mcp/lib/proxy.mjs` — stdio-to-HTTP MCP bridges.
- `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tailwind.config.ts`, `playwright.config.ts` — build/test/lint/style/e2e tooling.
- `README.md` — setup, hosted backend model, OAuth connector, and MCP stdio package guidance.

## Runtime/Tooling Preferences

- Package manager: npm (`package-lock.json` is lockfile v3; do not hand-edit).
- Runtime: Node.js for local scripts/dev/build; Deno for Supabase Edge Functions. The stdio package declares Node `>=18`.
- Bundler/dev server: Vite 6 with React plugin; dev server uses host `::` and port `8080`.
- Deployment: frontend is SPA-compatible with Vercel (`vercel.json` rewrites all routes to `/index.html`); backend deploys separately with Supabase CLI.
- Frontend env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- Edge Function secrets include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MCP_MASTER_PASSWORD`, `CLAUDE_OAUTH_CLIENT_ID`, `CLAUDE_OAUTH_CLIENT_SECRET`, optional `CLAUDE_OAUTH_REDIRECT_URIS`, optional `MCP_DEFAULT_USER_ID`, optional `BRAVE_SEARCH_API_KEY`, optional `BING_SEARCH_API_KEY`, optional agent/cache tuning vars.
- MCP stdio proxy env may include `MCP_ENDPOINT`, `MCP_REQUEST_TIMEOUT_MS`, `MCP_STDIO_DEBUG`, `MCP_SECRET`/`X_MCP_SECRET`, `GITHUB_TOKEN`, and `SUPABASE_ACCESS_TOKEN`.
- Protected/generated paths: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `node_modules/`, `dist/`, `.vercel/`, `.git/`, coverage/build output, and secret-bearing env files.

## Testing & QA

- Tests use Vitest with jsdom, globals, and setup in `src/test/setup.ts`; files match `src/**/*.{test,spec}.{ts,tsx}`.
- Component tests use Testing Library and jest-dom. Common patterns include `vi.mock`, `vi.hoisted`, `vi.stubGlobal("Deno", ...)`, `beforeEach`, `vi.resetModules()`, and `mockReset()`.
- Current coverage includes auth gate UI, API key UI basics, recency detection, MCP JSON-RPC helpers, tool registry, user settings, tool logging, Google News URL handling, HTML-to-Markdown conversion, URL utilities, agent fallback/cache/scrape behavior, and source deduplication.
- Playwright is configured through `playwright.config.ts`, but no npm script or e2e suite is currently wired.
- Add or update tests when changing logic, fixing bugs, auth behavior, MCP payloads, database access, or tool dispatch. Test behavior and edge cases, not implementation plumbing.
- For frontend/backend contract changes, verify both sides: TypeScript types, frontend caller behavior, Edge Function handler/helper tests, and relevant build/lint checks.
- Known QA caveats: no coverage thresholds, no visible CI workflow, Playwright not wired to scripts, and non-strict TypeScript means successful compilation is not enough evidence for payload correctness.
