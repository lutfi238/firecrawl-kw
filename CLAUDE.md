# CLAUDE.md

`AGENTS.md` is the source of truth for this project. Read it first for the full project overview, architecture, commands, environment variables, conventions, protected files, and pitfalls.

## Claude-specific workflow

- Inspect relevant files before editing; do not guess paths, schemas, or MCP request/response contracts.
- Prefer small, safe, targeted patches over broad rewrites.
- Explain risky changes before applying them, especially auth, RLS, Edge Function transport, API-key storage, OAuth, and migrations.
- Use shell verification for real checks (`npm run test`, `npm run lint`, `npm run build`) when relevant. Never fabricate command results.
- When changing architecture, routes, schema, commands, env vars, hosted backend behavior, or MCP client setup, update `AGENTS.md` and `README.md`.
- When touching both frontend and Edge Functions, verify request/response contracts on both sides.
- Do not edit generated Supabase artifacts, build outputs, lockfiles, or secrets unless explicitly requested.

## Quick reference

```bash
npm run dev    # Vite dev server on :8080
npm run test   # vitest run
npm run lint   # eslint .
npm run build  # production build
```

Important: MCP clients use per-user full `fc_kw-...` secrets. Prefixes are display-only and cannot authenticate. See `AGENTS.md` for details.
