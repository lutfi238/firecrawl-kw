# GEMINI.md

`AGENTS.md` is the source of truth for this project. Read it first for project overview, architecture, commands, environment variables, conventions, and known pitfalls.

## Project at a glance

- Vite + React + TypeScript frontend (`src/`) for a personal MCP dashboard.
- Deno Supabase Edge Function backend (`supabase/functions/mcp-server/`) exposing MCP JSON-RPC + a small REST API.
- Supabase Postgres + RLS + Auth; per-user MCP secrets, Supabase session tokens, and OAuth 2.1 for Claude Web.

## Commands

```bash
npm run dev    # Vite dev server on :8080
npm run lint   # eslint
npm run test   # vitest run
npm run build  # production build
```

## Rules for changes

- Inspect before editing; keep changes minimal and consistent with existing patterns.
- Preserve architecture and project-specific conventions unless asked to refactor.
- Do not edit generated Supabase artifacts, build outputs, lock files, or secrets.
- Run available checks and report real results; do not fabricate output.
- Update `AGENTS.md` and `README.md` when architecture, commands, routes, schema, or env vars change.

See `AGENTS.md` for the full conventions, API/database notes, and pitfalls.
