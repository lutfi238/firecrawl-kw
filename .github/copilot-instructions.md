# Copilot Instructions

## Project snapshot

This repository is a Vite + React + TypeScript app that operates as an MCP testing frontend backed by Supabase and several Edge Functions.

- Frontend app: `src/`
- Pages: `src/pages/`
- Shared components: `src/components/`
- Hooks: `src/hooks/`
- Shared contracts: `src/types/`
- Utilities: `src/lib/`
- Client auth state: `src/stores/`
- Supabase integration: `src/integrations/supabase/`
- Edge Functions: `supabase/functions/`
- SQL migrations: `migrations/`

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
4. Use `npm run build` for broader UI, routing, or integration changes.

## Architecture and boundaries

### Frontend

- `src/App.tsx` bootstraps React Query, routing, auth/session sync, and shared layout.
- `src/pages/` owns screen-level orchestration.
- `src/components/` should stay presentational or narrowly feature-focused.
- `src/components/ui/` contains reusable shadcn/radix-style primitives; keep them generic.
- `src/hooks/` encapsulates Supabase access, tool execution, settings retrieval, and async flows.
- `src/stores/authStore.ts` is a lightweight Zustand store for auth/session state only.
- Keep MCP and tool payload shapes aligned with `src/types/mcp.ts` and `src/types/tools.ts`.

### Supabase / Edge Functions

- `supabase/functions/mcp-server/index.ts` is the main JSON-RPC/MCP handler.
- Other functions support auth, logs, jobs, and uptime monitoring.
- Edge Functions run on Deno APIs and web-standard runtime primitives, not Node-only libraries.

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
- Preserve custom MCP headers such as `X-GitHub-Token` and `X-MCP-Secret` when editing transport code.

### Styling

- Tailwind utilities first.
- Match the existing cyber/glass visual language from `tailwind.config.ts` and `src/index.css`.
- Reuse Lucide, shadcn, and Radix patterns already present in the app.

## Important constraints

- Do not hand-edit `src/integrations/supabase/client.ts`; treat generated Supabase files as generated artifacts.
- TypeScript is not fully strict in `tsconfig.app.json`; review types carefully instead of assuming the compiler will catch everything.
- `supabase/config.toml` disables JWT verification for Edge Functions, so app-layer auth and request validation matter.
- Frontend env vars expected by the app include `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID`.

## Good reference files

- `src/App.tsx`
- `src/hooks/useMCPServer.ts`
- `src/components/ToolForm.tsx`
- `src/pages/ToolTester.tsx`
- `src/stores/authStore.ts`
- `src/types/mcp.ts`
- `src/types/tools.ts`
- `supabase/functions/mcp-server/index.ts`

## Documentation notes

- `README.md` is still a placeholder. If major behavior or setup changes are introduced, update `README.md` instead of scattering duplicate setup notes elsewhere.
- Prefer linking to existing docs over copying long documentation into instructions files.

## Agent guidance

- Be concise and practical.
- Gather local context before refactoring shared flows.
- Prefer minimal, targeted edits over broad rewrites.
- Do not replace project-specific patterns with generic alternatives unless there is a clear benefit.
- When touching both frontend and Edge Functions, verify request/response contracts on both sides.
- Call out follow-up work if a change likely also needs env updates, migrations, or Supabase regeneration.
