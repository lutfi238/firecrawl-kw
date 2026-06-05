# Repository Guidelines

## Project Overview

Firecrawl KW is a hosted MCP/SaaS-style dashboard for web-intelligence workflows: scraping, search, crawl, extraction, screenshots, AI chat, request monitoring, uptime checks, and per-user MCP/API secret management. The web app is a Vite + React + TypeScript frontend that talks to a centralized Supabase backend owned by the project. Normal users should not need to bring or configure their own Supabase project; they sign in, generate an MCP secret, and connect MCP clients through the published stdio proxy package. The backend is a set of Supabase Edge Functions on Deno, with `mcp-server` as the main HTTP JSON-RPC/MCP, REST, and OAuth handler.

## Tech Stack

- Frontend: React 18, TypeScript, Vite 6, React Router, TanStack Query, Zustand.
- UI: Tailwind CSS, Radix/shadcn-style primitives, Lucide icons, cyber/glass theme.
- Backend: Supabase Auth/Postgres/Storage client APIs plus Deno Edge Functions.
- MCP: HTTP JSON-RPC MCP endpoint plus npm stdio proxy package `firecrawl-kw-mcp`.
- Testing/tooling: Vitest + jsdom + Testing Library, ESLint 9, Playwright config present but not wired to an npm script.
- Package manager: npm (`package-lock.json` lockfile v3). `bun.lock` exists, but project scripts are npm-based.

## Architecture & Data Flow

- `src/main.tsx` mounts `src/App.tsx`; `App` wires React Query, routing, auth/session sync, hosted backend config gate, dashboard layout, MCP health polling, and toasters.
- Frontend flow: route in `src/pages/` → feature hook in `src/hooks/` → Supabase client or MCP Edge Function → React Query cache/UI state.
- Auth flow: Supabase Auth feeds `src/stores/authStore.ts`; Zustand is only for lightweight auth/session/GitHub-token state. Server/remote state belongs in TanStack Query.
- MCP client flow: `src/hooks/useMCPServer.ts` sends JSON-RPC `tools/call` requests to `getMcpEndpoint()` and preserves custom headers such as `Authorization`, `X-GitHub-Token`, and `X-MCP-Secret`.
- Hosted backend config: `src/lib/backendConfig.ts` derives the MCP endpoint from `VITE_SUPABASE_URL`; `src/lib/supabaseRuntime.ts` returns the generated hosted Supabase client and no longer supports user-supplied backend overrides.
- Backend flow: `supabase/functions/mcp-server/index.ts` handles HTTP/MCP/OAuth routing → auth modules resolve the user → `tools/definitions.ts` and `tools/callTool.ts` define/dispatch tools → logs/jobs/settings/API keys persist in Supabase.
- Supported MCP auth modes are per-user MCP secrets via `X-MCP-Secret`, Supabase session bearer tokens, and OAuth 2.1 bearer tokens for supported remote MCP clients. Legacy shared backend `MCP_SECRET` auth was removed.
- `supabase/config.toml` disables JWT verification for Edge Functions, so handler-level auth and request validation are security-critical.

## Monorepo Structure

This is not a formal workspace monorepo: there is no `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or `lerna.json`. The root app owns the frontend and Supabase functions. `packages/firecrawl-kw-mcp/` is a standalone npm-published package nested in the repo; keep its package metadata, README, and proxy code aligned with hosted backend behavior.

## Important Directories

- `src/pages/` — route-level orchestration (`Overview`, `ToolTester`, `APITester`, `ApiKeysPage`, `RequestMonitor`, `Settings`, `AIChat`, `DeploymentGuide`, `McpAuthorize`).
- `src/components/` — feature UI components; keep `src/components/ui/` generic shadcn/Radix primitives.
- `src/hooks/` — reusable app logic for MCP transport, tool execution, settings, request logs, uptime logs, and async flows.
- `src/lib/` — shared utilities and runtime config (`backendConfig.ts`, `supabaseRuntime.ts`, `utils.ts`, intent/recency/vision helpers).
- `src/stores/` — Zustand auth/session store only.
- `src/types/` — shared MCP/tool contracts; keep these aligned with Edge Function request/response shapes.
- `src/integrations/supabase/` — generated Supabase client/types; do not hand-edit.
- `src/test/` — Vitest unit/regression/component tests and MCP helper tests.
- `supabase/functions/` — Deno Edge Functions: `mcp-server`, `github-auth`, `mcp-logs`, `mcp-jobs`, `uptime-checker`.
- `supabase/migrations/` — SQL migrations for settings/logs/jobs/OAuth/uptime/API keys/source cache.
- `packages/firecrawl-kw-mcp/` — npm stdio MCP proxy package for clients that use `command`/`args`/`env`.
- `scripts/` — repo-local helpers, especially `scripts/mcp-stdio-proxy.mjs`.
- `docs/` — project documentation when present; prefer updating existing docs over duplicating setup notes.

## Development Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server on host ::, port 8080
npm run build      # production Vite build
npm run build:dev  # development-mode Vite build
npm run preview    # preview built frontend
npm run lint       # eslint .
npm run test       # vitest run
npm run test:watch # vitest watch mode
npm run mcp:stdio  # local MCP stdio proxy
```

Verification order: run the smallest relevant check first, use `npm run test` for logic changes, `npm run lint` after TypeScript/React edits, and `npm run build` for route, bundling, hosted-backend, or integration changes.

## Environment Variables

Document names only; never commit or echo secret values.

### Frontend Vite env

- `VITE_SUPABASE_URL` — hosted Supabase project URL; also used to derive `/functions/v1/mcp-server`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — hosted Supabase publishable/anon key used by the generated client.
- `VITE_SUPABASE_PROJECT_ID` — hosted Supabase project identifier expected by app/deployment docs.

### Supabase Edge Function secrets

- `SUPABASE_URL` — Supabase project URL for Edge Functions.
- `SUPABASE_ANON_KEY` — anon key for validating Supabase session bearer tokens.
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key for server-side DB reads/writes such as API-key verification and logs.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth integration.
- `MCP_MASTER_PASSWORD` — OAuth consent/admin gate used by the MCP OAuth flow.
- `CLAUDE_OAUTH_CLIENT_ID`, `CLAUDE_OAUTH_CLIENT_SECRET` — Claude/custom connector OAuth client credentials when configured.
- `CLAUDE_OAUTH_REDIRECT_URIS` — optional allowlist for Claude OAuth redirects.
- `MCP_DEFAULT_USER_ID` — optional fallback user id used only when no credential resolves a user.
- `BRAVE_SEARCH_API_KEY`, `BING_SEARCH_API_KEY` — optional search provider secrets.

### MCP stdio proxy env

- `MCP_SECRET` or `X_MCP_SECRET` — per-user full `fc_kw-...` MCP secret generated from the dashboard; the proxy forwards it as `X-MCP-Secret`.
- `MCP_ENDPOINT` — optional override for the hosted MCP endpoint.
- `MCP_REQUEST_TIMEOUT_MS` — optional request timeout override.
- `MCP_STDIO_DEBUG` — optional debug logging for MCP client setup.
- `GITHUB_TOKEN` — optional token forwarded to GitHub-related tools.
- `SUPABASE_ACCESS_TOKEN` — optional Supabase bearer token for authenticated dashboard-style calls.

## Database & API Notes

- Migrations live under `supabase/migrations/`; keep schema changes in SQL migrations and update generated Supabase types through the project’s normal regeneration flow when needed.
- `public.user_api_keys` stores `key_hash` and `key_prefix` for per-user MCP secrets. Current code returns the full key only once on create; existing full keys cannot be recovered from `key_hash`.
- API key format is `fc_kw-` plus a random component. `auth/apiKey.ts` also accepts legacy `fc_sk-` prefixes for verification.
- Prefix-only values are display identifiers and cannot authenticate. UI copy flows must not imply a prefix is the usable full key.
- If persistent full-key visibility is required, add encrypted storage (for example an `encrypted_key` column plus an `API_KEY_ENCRYPTION_SECRET`-style server secret) rather than plaintext. Old hash-only keys would still be unrecoverable.
- Main MCP endpoint: `supabase/functions/mcp-server/index.ts` supports health GET, OAuth discovery/register/authorize/token endpoints, JSON-RPC `initialize`, `tools/list`, `tools/call`, and REST endpoints such as `/v1/web/fetch` and `/v1/search`.
- Tool definitions and dispatch must stay synchronized between frontend contracts (`src/types/mcp.ts`, `src/types/tools.ts`) and backend tool definitions/handlers (`supabase/functions/mcp-server/tools/`).
- Edge Functions run on Deno/web-standard APIs. Do not introduce Node-only APIs under `supabase/functions/`.

## Coding & Naming Conventions

- Use functional React components with typed props.
- Keep page components orchestration-focused; move reusable behavior into hooks or narrowly-scoped components.
- Prefer `@/` imports for files under `src/`.
- Use TanStack Query for remote/server state; avoid expanding Zustand beyond small cross-app client state.
- Use `cn()` from `src/lib/utils.ts` for conditional class composition.
- Styling is Tailwind-first; match the existing cyber/glass visual language from `tailwind.config.ts` and `src/index.css`.
- Reuse Lucide, shadcn, Radix, existing hooks, and existing utilities before adding new abstractions or dependencies.
- TypeScript is not fully strict in `tsconfig.app.json`; manually review nullability, payload shapes, auth branches, and cross-boundary types.
- Preserve non-blocking GitHub token loading in `src/App.tsx` and preserve custom MCP headers in transport/proxy code.
- Delete obsolete code rather than leaving stale aliases, dead branches, or TODO placeholders.

## Agent Workflow Rules

- Inspect relevant files before editing; do not guess paths, schemas, or request/response contracts.
- Make minimal, targeted patches consistent with the existing architecture.
- Do not hand-edit generated Supabase files, lockfiles, build outputs, or secret-bearing env files.
- Never fabricate test/build/lint results. Run the command and report the real output, or state that validation was not run.
- When touching both frontend and Edge Functions, verify both sides of the contract.
- Update `AGENTS.md` and `README.md` when architecture, commands, routes, env vars, schema, hosted backend behavior, or MCP client setup changes.
- For docs/user-facing UI, hide Supabase implementation details from normal-user flows unless the context is admin/developer/deploy guidance.
- Prefer behavior-focused tests for auth, API-key handling, MCP payloads, tool dispatch, and bug fixes.

## Protected Files & Paths

Never edit these unless explicitly requested and you understand the generation/deployment implications:

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `node_modules/`
- `dist/`, `build/`, `coverage/`, `.vercel/`, `.git/`, cache directories
- Lockfiles (`package-lock.json`, `bun.lock`) unless dependency installation intentionally updates them
- Secret-bearing env files such as `.env`, `.env.local`, `.env.*.local`

## Known Pitfalls

- Normal users should use the hosted backend; do not reintroduce the old custom Supabase backend setup UI unless explicitly asked.
- The shared backend `MCP_SECRET` auth path has been removed. MCP clients should use per-user full `fc_kw-...` secrets from the dashboard.
- Full MCP/API secrets are currently shown only once during creation. Hash-only stored keys cannot be displayed later; users must regenerate if they lost the full value.
- `user_api_keys.key_prefix` is for display only. Do not make copy buttons copy only the prefix as if it were usable.
- `useUptimeLogs(90)` fetches raw logs with a finite limit, so older days may show `unknown`/no data even when monitoring works. A daily aggregate would be a better long-term 90-day history source.
- Playwright is configured but not exposed through `package.json` scripts.
- There is no visible CI workflow in the inspected files.
- `README.md` may lag behind code after major behavior changes; update it instead of scattering duplicate setup notes.
