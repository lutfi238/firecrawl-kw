# Copilot Instructions

## Project overview

This workspace is a Vite + React + TypeScript frontend backed by Supabase and several Supabase Edge Functions.

- Frontend source: `src/`
- Route pages: `src/pages/`
- Shared UI/components: `src/components/`
- Custom hooks: `src/hooks/`
- Shared types: `src/types/`
- Utilities: `src/lib/`
- Auth state: `src/stores/`
- Supabase client/types: `src/integrations/supabase/`
- Edge Functions: `supabase/functions/`
- SQL migrations: `migrations/`

## Run and verify

Use npm scripts from `package.json`:

- `npm run dev` — start Vite dev server on port `8080`
- `npm run build` — production build
- `npm run build:dev` — development-mode build
- `npm run lint` — ESLint
- `npm run test` — Vitest one-shot run
- `npm run test:watch` — Vitest watch mode
- `npm run preview` — preview built app

When making changes:

1. Run the smallest relevant verification first.
2. Prefer `npm run test` for logic changes.
3. Prefer `npm run lint` after TypeScript/React edits.
4. Prefer `npm run build` before finalizing broader UI or integration changes.

## Architecture and boundaries

### Frontend

- `src/App.tsx` wires React Query, routing, auth bootstrapping, and layout.
- Page components in `src/pages/` compose hooks and present feature-level screens.
- Components in `src/components/` are mostly presentational or small feature widgets.
- `src/components/ui/` contains shadcn/ui-style primitives; keep those generic and reusable.
- Hooks in `src/hooks/` encapsulate async behavior, Supabase access, tool execution, and settings retrieval.
- Zustand state in `src/stores/` is used for lightweight global auth/session data.
- Tool and MCP contracts live in `src/types/` and should stay aligned with the backend payload shape.

### Backend

- `supabase/functions/mcp-server/index.ts` is the main MCP JSON-RPC handler.
- Other functions handle auth, logs, jobs, and uptime checks.
- Edge Functions use Deno-style imports and runtime APIs, not Node-specific patterns.

## Code conventions

### React and TypeScript

- Use functional React components and typed props interfaces.
- Follow existing alias imports using `@/` for files under `src/`.
- Prefer existing hooks and shared utilities over duplicating logic.
- Use `cn()` from `src/lib/utils.ts` for conditional class composition.
- Keep page components orchestration-focused and move reusable UI into components or hooks.

### Styling

- Use Tailwind utilities first.
- Reuse the theme tokens and cyber color palette already defined in `tailwind.config.ts` and `src/index.css`.
- Existing UI favors shadcn/radix primitives, Lucide icons, glass/cyber styling, and dark-mode-friendly visuals.

### State and data flow

- Use React Query for remote/server state.
- Use Zustand only for small cross-app client state like auth/session.
- Keep Supabase access patterns consistent with existing hooks and client usage.

## Supabase and auth notes

- `src/integrations/supabase/client.ts` is auto-generated; do not hand-edit it.
- Frontend environment variables are required, including:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_SUPABASE_PROJECT_ID`
- GitHub token loading is intentionally asynchronous in `src/App.tsx`; do not block initial UI rendering on it.
- MCP requests may depend on custom headers such as `X-GitHub-Token` and `X-MCP-Secret`; preserve this behavior when editing client/server integrations.
- `supabase/config.toml` currently disables JWT verification for Edge Functions, so app-level auth flow and request validation matter.

## Testing guidance

- Vitest uses `jsdom` and `src/test/setup.ts`.
- Add or update focused tests for logic-heavy changes under `src/**/*.{test,spec}.{ts,tsx}`.
- If changing browser-dependent behavior, account for the existing mocked `matchMedia` setup.

## Important pitfalls

- TypeScript is intentionally not fully strict in `tsconfig.app.json`; do not assume unused code or weak typing will be caught automatically.
- Vite path aliasing must stay consistent with both Vite and TypeScript config.
- Supabase-generated files and schema-derived types should be regenerated, not manually rewritten.
- Edge Functions run in a Deno environment, so Node-only APIs or package assumptions can break deployment.

## High-value reference files

Use these files to match existing patterns before making changes:

- `src/App.tsx` — app bootstrap, auth flow, routing
- `src/hooks/useMCPServer.ts` — MCP transport, headers, SSE handling
- `src/components/ToolForm.tsx` — dynamic form rendering from metadata
- `src/pages/ToolTester.tsx` — page-level orchestration example
- `src/stores/authStore.ts` — Zustand auth state pattern
- `src/types/mcp.ts` — MCP contract shapes
- `src/types/tools.ts` — tool metadata definitions
- `supabase/functions/mcp-server/index.ts` — backend handler conventions
- `tailwind.config.ts` — theme tokens and shared design language

## Documentation status

`README.md` is currently only a placeholder. If you add major features or setup changes, update `README.md` instead of creating duplicate setup notes elsewhere unless the change clearly needs dedicated documentation.

## Agent behavior for this workspace

- Be concise and practical.
- Gather context from existing files before refactoring shared flows.
- Do not replace project-specific patterns with generic ones unless there is a clear local benefit.
- Prefer minimal, targeted edits over broad rewrites.
- When touching both frontend and Edge Functions, verify request/response contracts on both sides.
- Call out when a change likely also requires environment, migration, or Supabase regeneration steps.

## Suggested next customizations

If this workspace grows, consider adding scoped instructions for:

- `src/components/**` for UI and accessibility conventions
- `supabase/functions/**` for Deno/Edge Function rules
- `src/test/**` for testing patterns and fixtures
- `migrations/**` for database migration review expectations
