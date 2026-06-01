# Repository Guidelines

## Project Overview

Personal Firecrawl MCP is a Vite + React + TypeScript dashboard for operating a personal MCP (Model Context Protocol) server backed by Supabase. It lets authenticated users run web-intelligence tools for search, scrape, crawl, extraction, screenshots, batch jobs, AI chat, request monitoring, uptime checks, and MCP/API-key management. The backend is Supabase Edge Functions on Deno, primarily `mcp-server`, exposing MCP JSON-RPC plus a small REST API.

## Architecture & Data Flow

- `src/main.tsx` mounts `src/App.tsx`; `App` wires `QueryClientProvider`, `BrowserRouter`, auth/session sync, backend configuration gating, layout, routes, and toasters.
- Frontend data flow: route/page component → feature hook (`src/hooks/`) → Supabase client or MCP Edge Function → React Query cache/UI state.
- Auth flow: `AuthGate` and `AuthListener` use Supabase Auth; `src/stores/authStore.ts` stores only auth/session/GitHub-token state in Zustand. Server data belongs in TanStack Query, not Zustand.
- Backend selection is centralized on the hosted Supabase project from Vite env config via `src/lib/backendConfig.ts` and `src/lib/supabaseRuntime.ts`; normal users do not configure their own Supabase backend.
- MCP calls go through `src/hooks/useMCPServer.ts`, which sends JSON-RPC `tools/call` requests to the configured Edge Function and preserves custom headers such as `Authorization`, `X-GitHub-Token`, and `X-MCP-Secret`.
- Supabase Edge Function flow: `supabase/functions/mcp-server/index.ts` handles HTTP/MCP/OAuth routing → auth modules resolve the user → tool definitions/dispatch in `tools/definitions.ts` and `tools/callTool.ts` → logs/jobs/settings persisted in Supabase.
- Auth modes are per-user MCP secrets (`X-MCP-Secret`), Supabase session bearer tokens, and OAuth 2.1 bearer tokens for Claude Web connectors. `supabase/config.toml` sets `verify_jwt = false`, so handler-level auth is security-critical.
- Database schema changes live in `supabase/migrations/`; RLS is expected on user data tables. OAuth tables are service-role-only with RLS enabled and no user policies.

## Key Directories

- `src/pages/` — route-level screens such as `Overview`, `ToolTester`, `APITester`, `ApiKeysPage`, `RequestMonitor`, `Settings`, `AIChat`, `DeploymentGuide`, `BackendSetup`, and `McpAuthorize`.
- `src/components/` — feature UI components; keep `src/components/ui/` generic shadcn/Radix-style primitives.
- `src/hooks/` — reusable app logic for MCP transport, tool execution, settings, request logs, uptime logs, and Supabase-backed flows.
- `src/lib/` — shared utilities and runtime config (`utils.ts`, `backendConfig.ts`, `supabaseRuntime.ts`).
- `src/stores/` — Zustand store for auth/session state only.
- `src/types/` — shared MCP/tool contracts; keep these aligned with Edge Function request/response shapes.
- `src/integrations/supabase/` — generated Supabase client/types; do not hand-edit.
- `src/test/` — Vitest unit/regression/component tests, including Edge Function helper tests under `src/test/mcp/`.
- `supabase/functions/` — Deno Edge Functions: `mcp-server`, `github-auth`, `mcp-logs`, `mcp-jobs`, `uptime-checker`.
- `supabase/migrations/` — SQL migrations for logs, jobs, OAuth, uptime, and per-user MCP API keys.
- `packages/firecrawl-kw-mcp/` — npm-style stdio MCP proxy package for `npx -y firecrawl-kw-mcp`, defaulting to the hosted Supabase MCP endpoint.
- `scripts/` — local development helpers, including `scripts/mcp-stdio-proxy.mjs` for repo-local MCP stdio testing.

## Development Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server, configured for port 8080
npm run build      # production Vite build
npm run build:dev  # development-mode Vite build
npm run preview    # preview built frontend
npm run lint       # eslint .
npm run test       # vitest run
npm run test:watch # vitest watch mode
npm run mcp:stdio  # run local MCP stdio proxy
```

Use the smallest relevant check first. Prefer `npm run test` for logic changes, `npm run lint` after TypeScript/React edits, and `npm run build` for route, bundling, or integration changes.

## Code Conventions & Common Patterns

- React code uses functional components with typed props. Keep page components orchestration-focused; move reusable behavior into hooks or narrow components.
- Use `@/` imports for files under `src/`.
- Styling is Tailwind-first. Match the existing cyber/glass theme in `tailwind.config.ts` and `src/index.css`; reuse Lucide icons and existing shadcn/Radix primitives before adding UI patterns.
- Use `cn()` from `src/lib/utils.ts` for conditional class composition.
- Use TanStack Query for remote/server state and cache invalidation. Use Zustand only for small cross-app client auth/session state.
- Supabase access should go through `getSupabaseClient()` from `src/lib/supabaseRuntime.ts`, not direct imports from generated client files.
- MCP/tool payload contracts should stay synchronized between `src/types/mcp.ts`, `src/types/tools.ts`, frontend callers, and `supabase/functions/mcp-server/tools/`.
- Edge Functions run on Deno/web-standard APIs; avoid Node-only APIs in `supabase/functions/`.
- TypeScript is not fully strict in `tsconfig.app.json`; manually review nullability, payload shapes, and cross-boundary types.
- Preserve non-blocking GitHub token loading in `src/App.tsx` and custom MCP headers in transport code.
- Do not add abstractions before reusing existing hooks/utilities/components.
- Never commit secrets. Document env var names only, not values.

## Important Files

- `src/App.tsx` — app providers, routing, auth listener, backend config gate, MCP health polling.
- `src/hooks/useMCPServer.ts` — MCP JSON-RPC and streaming client.
- `src/hooks/useToolExecutor.ts` and `src/hooks/useToolExecutorWithActivity.ts` — tool execution wrappers and activity/timeout behavior.
- `src/lib/backendConfig.ts` — hosted Supabase backend config derived from Vite env values.
- `src/lib/supabaseRuntime.ts` — runtime Supabase client factory and MCP endpoint helpers.
- `src/stores/authStore.ts` — auth/session Zustand store.
- `src/types/mcp.ts` and `src/types/tools.ts` — shared frontend MCP contracts and tool definitions.
- `supabase/functions/mcp-server/index.ts` — main MCP/REST/OAuth HTTP handler.
- `supabase/functions/mcp-server/auth/mcpSecret.ts` — per-user MCP secret, OAuth bearer, and Supabase session auth resolution.
- `supabase/functions/mcp-server/auth/oauth.ts` — OAuth 2.1/DCR/PKCE support for Claude Web connectors.
- `supabase/functions/mcp-server/tools/callTool.ts` — central tool dispatch implementation.
- `supabase/functions/mcp-server/tools/definitions.ts` — dynamic MCP tool schemas.
- `supabase/config.toml` — Edge Function JWT verification settings and Supabase project ref.
- `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tailwind.config.ts`, `playwright.config.ts` — build/test/lint/style/e2e tooling.
- `README.md` — setup, hosted backend model, OAuth connector, and npm stdio package guidance.

## Runtime/Tooling Preferences

- Package manager: npm; scripts are defined in `package.json`.
- Runtime: Node.js for local scripts/dev/build; Deno runtime for Supabase Edge Functions.
- Bundler/dev server: Vite 6 with React plugin; dev server uses port `8080`.
- Deployment: frontend is SPA-compatible with Vercel (`vercel.json` rewrites all routes to `/index.html`); backend deploys as Supabase Edge Functions.
- Frontend env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- Edge Function secrets include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MCP_MASTER_PASSWORD`, `CLAUDE_OAUTH_CLIENT_ID`, `CLAUDE_OAUTH_CLIENT_SECRET`, optional `CLAUDE_OAUTH_REDIRECT_URIS`, optional `MCP_DEFAULT_USER_ID`, optional `BRAVE_SEARCH_API_KEY`, optional `BING_SEARCH_API_KEY`, optional `AGENT_LLM_MODEL`, optional `AGENT_MAX_CONTEXT_TOKENS`, and optional `AGENT_SOURCE_CACHE_TTL_SECONDS`.
- MCP stdio proxy env may include `MCP_ENDPOINT` (optional override), `MCP_REQUEST_TIMEOUT_MS`, `MCP_STDIO_DEBUG`, `MCP_SECRET` / `X_MCP_SECRET` (per-user key), `GITHUB_TOKEN`, and `SUPABASE_ACCESS_TOKEN`.
- Protected/generated paths: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `node_modules/`, `dist/`, `.vercel/`, `.git/`, coverage/build output, and secret-bearing env files.

## Testing & QA

- Unit/component/regression tests use Vitest with jsdom, globals, and setup in `src/test/setup.ts`.
- Test files match `src/**/*.{test,spec}.{ts,tsx}` and currently live under `src/test/`.
- Component tests use Testing Library and jest-dom. Common mocks use `vi.mock`, `vi.hoisted`, `vi.stubGlobal("Deno", ...)`, `beforeEach`, `vi.resetModules()`, and `mockReset()`.
- Existing coverage includes recency/intent routing, API key UI basics, auth gate UI, MCP JSON-RPC helpers, tool registry, user settings, tool logging, Google News URL handling, HTML-to-Markdown conversion, and URL utilities.
- Playwright is configured through `playwright.config.ts` and `playwright-fixture.ts`, but there is no package script or e2e spec suite currently wired.
- Add or update tests when changing logic, fixing bugs, auth behavior, MCP payloads, database access, or tool dispatch. Test behavior and edge cases, not implementation plumbing.
- For frontend/backend contract changes, verify both sides: TypeScript types, frontend caller behavior, Edge Function handler/utility tests, and relevant build/lint checks.
- Known QA caveats: no coverage thresholds, no visible CI workflow, and TypeScript non-strict mode means successful compilation is not enough evidence for payload correctness.
