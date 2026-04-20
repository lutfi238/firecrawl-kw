---
description: Use when editing Supabase Edge Functions under `supabase/functions/**`, especially for MCP transport, auth validation, Deno runtime compatibility, or request/response contract changes.
applyTo: "supabase/functions/**/*.ts"
---

# Supabase Edge Function Instructions

- Edge Functions run on Deno and web-standard APIs, so avoid Node-only packages and Node globals.
- Preserve request/response contracts expected by the frontend, especially MCP JSON-RPC payload shapes and SSE behavior.
- Treat auth and request validation carefully because `supabase/config.toml` disables JWT verification.
- Prefer localized edits; `supabase/functions/mcp-server/index.ts` is large and mixes transport plus scraping helpers.
- If a change affects settings, headers, or auth flow, cross-check `src/hooks/useMCPServer.ts` and `src/App.tsx`.
