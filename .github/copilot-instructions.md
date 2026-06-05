# Copilot Instructions

Read `AGENTS.md` for the full project context. This file is a concise coding guide for GitHub Copilot.

## Project snapshot

Firecrawl KW is a hosted MCP dashboard built with Vite + React + TypeScript. The frontend in `src/` uses Supabase Auth/Postgres and Deno Edge Functions in `supabase/functions/`; `supabase/functions/mcp-server/index.ts` is the main MCP JSON-RPC, REST, and OAuth handler. `packages/firecrawl-kw-mcp/` contains the npm stdio proxy package used by local MCP clients.

## Verify with existing scripts

Use the existing `package.json` scripts:

- `npm run dev`
- `npm run test`
- `npm run lint`
- `npm run build`

Verification order:

1. Run the smallest relevant check first.
2. Use `npm run test` for logic changes.
3. Use `npm run lint` after TypeScript or React edits.
4. Use `npm run build` for broader UI, routing, hosted-backend, or integration changes.

## Architecture and boundaries

### Frontend

- `src/App.tsx` bootstraps React Query, routing, auth/session sync, backend health/config checks, and shared layout.
- `src/pages/` owns screen-level orchestration.
- `src/components/` should stay presentational or narrowly feature-focused.
- `src/components/ui/` contains reusable shadcn/Radix-style primitives; keep them generic.
- `src/hooks/` encapsulates Supabase access, MCP transport, tool execution, settings retrieval, and async flows.
- `src/stores/authStore.ts` is a lightweight Zustand store for auth/session state only.
- Keep MCP and tool payload shapes aligned with `src/types/mcp.ts`, `src/types/tools.ts`, and backend tool definitions.

### Supabase / Edge Functions

- `supabase/functions/mcp-server/index.ts` is the main JSON-RPC/MCP handler.
- Other functions support GitHub auth, logs, jobs, and uptime monitoring.
- Edge Functions run on Deno APIs and web-standard runtime primitives, not Node-only libraries.
- `supabase/config.toml` disables JWT verification for Edge Functions, so app-layer auth and request validation matter.
- MCP auth accepts per-user full `fc_kw-...` secrets via `X-MCP-Secret`, Supabase session bearer tokens, and OAuth bearer tokens. Do not reintroduce shared backend `MCP_SECRET` auth.

## Local conventions

### React / TypeScript

- Use functional components with typed props.
- Prefer `@/` imports for files under `src/`.
- Reuse existing hooks, utilities, and UI primitives before adding new abstractions.
- Keep page components orchestration-focused; move reusable logic into hooks/components.
- Use `cn()` from `src/lib/utils.ts` for conditional class composition.

### State and data flow

- Use React Query for remote/server state.
- Use Zustand only for small cross-app client state.
- Preserve the non-blocking GitHub token loading flow in `src/App.tsx`.
- Preserve custom MCP headers such as `X-GitHub-Token` and `X-MCP-Secret` when editing transport/proxy code.

### Styling

- Tailwind utilities first.
- Match the existing cyber/glass visual language from `tailwind.config.ts` and `src/index.css`.
- Reuse Lucide, shadcn, and Radix patterns already present in the app.

## Important constraints

- Do not hand-edit `src/integrations/supabase/client.ts` or `src/integrations/supabase/types.ts`; treat generated Supabase files as generated artifacts.
- TypeScript is not fully strict in `tsconfig.app.json`; review types carefully instead of assuming the compiler will catch everything.
- Frontend env vars expected by the app include `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID`.
- Full MCP/API secrets are currently shown only once during creation. `key_prefix` is display-only and cannot authenticate.
- When changing hosted backend behavior, MCP setup, env vars, schema, or architecture, update `AGENTS.md` and `README.md`.

## Good reference files

- `src/App.tsx`
- `src/hooks/useMCPServer.ts`
- `src/components/ToolForm.tsx`
- `src/pages/ToolTester.tsx`
- `src/pages/ApiKeysPage.tsx`
- `src/stores/authStore.ts`
- `src/types/mcp.ts`
- `src/types/tools.ts`
- `supabase/functions/mcp-server/index.ts`
- `supabase/functions/mcp-server/auth/apiKey.ts`
- `supabase/functions/mcp-server/tools/callTool.ts`

## Agent guidance

- Be concise and practical.
- Gather local context before refactoring shared flows.
- Prefer minimal, targeted edits over broad rewrites.
- Do not replace project-specific patterns with generic alternatives unless there is a clear benefit.
- When touching both frontend and Edge Functions, verify request/response contracts on both sides.
- Call out follow-up work if a change likely also needs env updates, migrations, Supabase type regeneration, npm package publishing, or deployment.
