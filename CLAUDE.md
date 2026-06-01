# CLAUDE.md

`AGENTS.md` is the source of truth for this project. Read it first for project overview, architecture, commands, env vars, conventions, and pitfalls.

## Claude-specific workflow

- Inspect relevant files before editing; do not guess paths or contracts.
- Prefer small, safe, targeted patches over large rewrites.
- Explain risky changes (auth, RLS, Edge Function transport, migrations) before applying, and confirm destructive actions.
- Never fabricate command results. Run `npm run lint` / `npm run test` / `npm run build` and report real output, or say you did not run them.
- When changing architecture, routes, schema, commands, or env vars, update `AGENTS.md` and `README.md` so docs stay accurate.
- When touching both frontend and Edge Functions, verify request/response contracts on both sides.

## Quick reference

```bash
npm run dev    # Vite dev server on :8080
npm run lint   # eslint
npm run test   # vitest run
npm run build  # production build
```

Do not edit generated Supabase artifacts (`src/integrations/supabase/`), build outputs, or secrets. See `AGENTS.md` for the full protected list and known pitfalls.
