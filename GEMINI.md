# GEMINI.md

`AGENTS.md` is the source of truth for this project. Read it first for architecture, commands, env vars, conventions, protected files, and known pitfalls.

## Project at a glance

- Vite + React + TypeScript hosted dashboard in `src/`.
- Supabase Auth/Postgres plus Deno Edge Functions in `supabase/functions/`.
- Main backend is `supabase/functions/mcp-server/`, exposing MCP JSON-RPC, REST helpers, and OAuth endpoints.
- `packages/firecrawl-kw-mcp/` is the npm stdio proxy package for MCP clients.

## Gemini-specific workflow

- Use context efficiently: inspect targeted files and use search before reading large files.
- Prefer direct, minimal edits over full-file rewrites unless a full rewrite is safer for a small agent context file.
- Preserve existing project patterns: `@/` imports, typed functional components, Tailwind/Radix UI, TanStack Query for server state, Zustand only for auth/session state.
- Do not edit generated Supabase artifacts, build outputs, lockfiles, or secrets.
- Run available checks when relevant and report real results; do not infer success.
- Update `AGENTS.md` and `README.md` when architecture, commands, routes, schema, env vars, hosted backend behavior, or MCP setup changes.

## Quick reference

```bash
npm run dev    # Vite dev server on :8080
npm run test   # vitest run
npm run lint   # eslint .
npm run build  # production build
```

MCP/API secret caveat: current storage is hash + prefix only. Full `fc_kw-...` keys are shown once at creation; prefixes are not usable credentials.
