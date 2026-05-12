# Add OAuth 2.1 to MCP Server for Claude Web

## Goal
Make the MCP server connectable from Claude Web's "Add custom connector" using only the URL (and optionally OAuth Client ID/Secret), without exposing any secret to the browser. Keep `X-MCP-Secret` header working for existing clients.

## Approach
Implement the **MCP Authorization spec (OAuth 2.1 + Dynamic Client Registration)** directly inside the existing `mcp-server` Edge Function. Claude Web auto-discovers the endpoints, registers itself as a client, walks the user through an authorization page, and then sends `Authorization: Bearer <token>` on every MCP request.

A new server-side `MCP_MASTER_PASSWORD` secret gates the consent page so only you can grant tokens. The existing `MCP_SECRET` header path stays as an alternative for non-OAuth clients (rotated to a new value).

## Endpoints Added (all on the same `mcp-server` function)

| Path | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | Tells Claude where the auth server lives |
| `GET /.well-known/oauth-authorization-server` | OAuth discovery metadata |
| `POST /register` | Dynamic Client Registration (RFC 7591) — Claude self-registers |
| `GET /authorize` | Renders a tiny HTML consent page with password field |
| `POST /authorize` | Validates master password, issues authorization code, redirects back to Claude with `code` + `state` (PKCE-checked) |
| `POST /token` | Exchanges code for access token (PKCE verified); also handles `refresh_token` grant |
| `POST /` (existing) | MCP JSON-RPC — now accepts EITHER `Authorization: Bearer <token>` OR `X-MCP-Secret` |

## Storage (new tables via migration)
- `oauth_clients` — `client_id`, `client_secret_hash`, `redirect_uris[]`, `name`, `created_at`
- `oauth_codes` — `code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `expires_at`, `used`
- `oauth_tokens` — `access_token_hash`, `refresh_token_hash`, `client_id`, `expires_at`, `revoked`

All tables are service-role only (RLS denies everything; Edge Function uses service role key).

## Auth Flow Validation in MCP Handler
Update `index.ts`:
1. If `X-MCP-Secret` header present → check against `MCP_SECRET` env (existing path).
2. Else if `Authorization: Bearer <token>` → look up token hash in `oauth_tokens`, verify not expired/revoked.
3. Else → return `401` with `WWW-Authenticate: Bearer resource_metadata="https://.../.well-known/oauth-protected-resource"` so Claude knows to start OAuth.

## Secrets
- **Rotate** `MCP_SECRET` to a new value (old one is compromised).
- **Add** `MCP_MASTER_PASSWORD` — the password you type into the consent page when Claude redirects you there.
- Use existing `SUPABASE_SERVICE_ROLE_KEY` for DB writes from the function.

## Logging
- `[oauth] register` on DCR
- `[oauth] authorize success/fail` with client_id (no password)
- `[oauth] token issued/refresh/invalid_grant`
- `[mcp] auth bearer ok / secret ok / unauthorized` on each MCP call
- `[mcp] tools/call name=<tool>` on forwarding

## Files Touched
- `supabase/functions/mcp-server/auth/oauth.ts` (new) — discovery, register, authorize, token, bearer validation
- `supabase/functions/mcp-server/auth/mcpSecret.ts` — relax to allow bearer fallback
- `supabase/functions/mcp-server/index.ts` — route new paths, integrate new auth
- `supabase/functions/mcp-server/auth/db.ts` (new) — service-role Supabase client
- New migration for the three OAuth tables
- `src/pages/Overview.tsx` — add a "Claude Web" config card with the connector URL and instructions
- `README.md` — setup + test checklist section

## Setup Instructions Delivered to User (after build)
1. Add secret `MCP_MASTER_PASSWORD` (you'll be prompted).
2. Rotate `MCP_SECRET` (you'll be prompted).
3. In Claude Web → Settings → Connectors → Add custom connector:
   - **Name:** Firecrawl MCP
   - **Remote MCP server URL:** `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server`
   - Leave OAuth Client ID/Secret **blank** (DCR fills them automatically).
4. Claude opens a consent page → enter `MCP_MASTER_PASSWORD` → approve.
5. Tools should appear; try a `scrape` or `search`.

## Test Checklist
- [ ] `curl .../.well-known/oauth-protected-resource` returns JSON
- [ ] `curl .../.well-known/oauth-authorization-server` returns JSON with `registration_endpoint`, `authorization_endpoint`, `token_endpoint`
- [ ] `POST /register` with `{redirect_uris:[...]}` returns `client_id` + `client_secret`
- [ ] MCP POST without auth → 401 with `WWW-Authenticate` header pointing to discovery
- [ ] MCP POST with valid bearer → tools list returned
- [ ] MCP POST with old `X-MCP-Secret` (after rotation) → 401
- [ ] MCP POST with new `X-MCP-Secret` → tools list returned
- [ ] Claude Web add-connector flow completes, lists 15 tools, can call `scrape`

## Out of Scope
- No per-user accounts; single master-password gate is sufficient for a personal server.
- No token introspection endpoint; tokens are opaque and validated by hash lookup.

Approve to proceed.
