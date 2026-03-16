

# Personal Firecrawl MCP Server — Full Build Plan

## Pre-requisite: Connect Supabase

Supabase is **not yet connected** to this project. We need it for GitHub OAuth, Edge Functions, and the database. Please connect it first (either Lovable Cloud or an external project), then I can proceed.

---

## Build Summary (once Supabase is connected)

This is a massive build covering ~30+ new files. Here's the full scope:

### 1. Foundation
- Install `zustand`, `@supabase/supabase-js`
- Add Google Fonts (Orbitron, Inter, JetBrains Mono) to `index.html`
- Override CSS variables for cyber theme (#080D1A background, cyan/violet accents)
- Add custom Tailwind colors (`cyber-bg`, `cyber-surface`, `cyber-cyan`, `cyber-violet`, etc.) and keyframes (pulse-glow, dot-grid)
- Create `src/lib/supabase.ts` client
- Create `src/types/mcp.ts` and `src/types/tools.ts` with tool schemas

### 2. GitHub OAuth + Auth Store
- **Zustand store** (`src/stores/authStore.ts`): `user`, `githubToken`, `isAuthenticated`, `loading`
- `onAuthStateChange` listener in App.tsx extracts `session.provider_token`
- **AuthGate component**: Full-screen glassmorphic overlay with "Login with GitHub" button when unauthenticated
- `signInWithOAuth({ provider: 'github', options: { scopes: 'read:user copilot' } })`
- All dashboard pages wrapped in AuthGate

### 3. Layout Shell
- **Sidebar** (240px, collapsible): Orbitron logo, 5 nav items with cyan active glow
- **TopBar**: Breadcrumb, server status pill (pulsing green/red), GitHub avatar + username, logout
- **5 routes**: `/` Overview, `/tester` Tool Tester, `/monitor` Request Monitor, `/settings` Settings, `/chat` AI Chat
- CSS dot-grid animated background
- Mobile: sidebar collapses, responsive stacking

### 4. Database (SQL migrations)
- **`mcp_logs`** table: id, user_id, tool, input (jsonb), output (jsonb), status, duration_ms, created_at
- **`settings`** table: id, user_id, key, value, unique(user_id, key)
- RLS: authenticated users access own rows only

### 5. MCP Server Edge Function (`supabase/functions/mcp-server/index.ts`)
- mcp-lite + Hono over StreamableHttpTransport
- `verify_jwt = false` in config.toml, CORS for all origins
- **10 tools**: search (DDG lite), scrape (HTML→MD), scrape_js (Railway proxy), crawl (BFS), map (URL-only crawl), extract (Copilot Claude Haiku 4.5), screenshot (Railway proxy), search_and_scrape, html_to_markdown, batch_scrape
- **Copilot token caching** (user's request):
  - Module-level `Map<string, { token: string; expiresAt: number }>`
  - Key = GitHub token, value = cached Copilot token + expiry
  - On `extract` call: check cache → if `Date.now() < expiresAt` use cached → else exchange and cache with `expiresAt = new Date(data.expires_at).getTime() - 60_000`
- Railway tools (scrape_js, screenshot) gracefully error if `RAILWAY_RENDERER_URL` env not set

### 6. Logs Edge Function (`supabase/functions/mcp-logs/index.ts`)
- POST: insert log entry
- GET: query with filters (tool, status, date range)
- DELETE: clear user's logs

### 7. Dashboard Pages

**Overview** (`/`): Gradient Orbitron title, server status card (pings MCP endpoint), endpoint URL + copy button, Claude Code CLI config JSON + copy button, stats row (requests today, 10 tools, uptime), tool cards grid

**Tool Tester** (`/tester`): Tool selector dropdown, dynamic form from tool schemas, Execute button → JSON-RPC `tools/call` to MCP endpoint with auto-attached `X-GitHub-Token`, response panel with syntax-highlighted JSON, duration badge, copy button

**Request Monitor** (`/monitor`): Polls `/mcp-logs` every 3s, table with time/tool/input/status/duration, color-coded status badges, expandable rows, filters, export JSON + clear logs

**Settings** (`/settings`): GitHub OAuth status card (avatar, username, Copilot status badge, re-auth/logout buttons — NO manual token input), Railway config inputs (URL + secret saved to `settings` table, test connection button), danger zone (clear logs)

**AI Chat** (`/chat`): Chat thread, slash commands trigger MCP tools inline, tool results as expandable cards, uses GitHub token from auth store

### 8. Shared Components
- GlassCard, StatusBadge, ConfigCopier, ToolCard, ToolForm, ResponseViewer, RequestLogTable, ChatPanel

### 9. Hooks
- `useMCPServer` — JSON-RPC calls with auto GitHub token header
- `useRequestLogs` — React Query polling for logs
- `useToolExecutor` — Execute tool + track duration + log result
- `useSettings` — CRUD for Railway config

---

## File Structure
```text
src/
  stores/authStore.ts
  lib/supabase.ts
  types/mcp.ts, tools.ts
  hooks/useAuth.ts, useMCPServer.ts, useRequestLogs.ts, useToolExecutor.ts, useSettings.ts
  components/
    Sidebar.tsx, TopBar.tsx, AuthGate.tsx, DashboardLayout.tsx
    GlassCard.tsx, StatusBadge.tsx, ConfigCopier.tsx
    ToolCard.tsx, ToolForm.tsx, ResponseViewer.tsx
    RequestLogTable.tsx, ChatPanel.tsx, DotGrid.tsx
  pages/
    Overview.tsx, ToolTester.tsx, RequestMonitor.tsx, Settings.tsx, AIChat.tsx
supabase/
  config.toml
  functions/mcp-server/index.ts, deno.json
  functions/mcp-logs/index.ts
```

## First Step

Connect Supabase to this project, then I'll build everything in one pass.

