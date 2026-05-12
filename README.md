# Personal Firecrawl MCP

Personal Firecrawl MCP adalah dashboard web untuk menjalankan MCP server pribadi berbasis Supabase Edge Functions. Aplikasi ini menyediakan 15 tool web intelligence untuk search, scrape, crawl, extraction, screenshot, batch job, AI chat, monitoring request, dan uptime.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS + Radix/shadcn-style components
- TanStack Query + Zustand
- Supabase Auth, Postgres, RLS, dan Edge Functions
- Vitest untuk unit/regression tests

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test
```

Dev server Vite dikonfigurasi di `vite.config.ts` untuk host `::` dan port `8080`.

## Environment

Frontend membutuhkan:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Supabase Edge Functions membutuhkan:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `MCP_SECRET` untuk legacy MCP clients yang bisa mengirim header `X-MCP-Secret`
- `MCP_MASTER_PASSWORD` untuk consent page OAuth MCP
- `CLAUDE_OAUTH_CLIENT_ID` untuk Claude Web custom connector
- `CLAUDE_OAUTH_CLIENT_SECRET` untuk Claude Web custom connector
- `CLAUDE_OAUTH_REDIRECT_URIS` optional, default `https://claude.ai/api/mcp/auth_callback`

## Claude Web custom connector

Claude Web tidak mendukung custom header seperti `X-MCP-Secret`. Remote MCP endpoint ini mendukung OAuth 2.1 agar bisa ditambahkan lewat **Add custom connector** tanpa mengekspos secret di browser, URL query, atau frontend code.

### 1. Rotate backend secrets

Anggap nilai `X-MCP-Secret` lama sudah compromised jika pernah dipaste ke chat/log. Buat nilai baru yang panjang dan acak, lalu simpan hanya sebagai Supabase Edge Function secret:

```bash
supabase secrets set MCP_SECRET="<new-random-legacy-mcp-secret>"
supabase secrets set MCP_MASTER_PASSWORD="<new-random-consent-password>"
supabase secrets set CLAUDE_OAUTH_CLIENT_ID="firecrawl-kw-claude"
supabase secrets set CLAUDE_OAUTH_CLIENT_SECRET="<new-random-oauth-client-secret>"
```

`MCP_SECRET` hanya untuk MCP clients lain yang memang bisa mengirim header. Claude Web tidak pernah menerima nilai ini.

### 2. Apply OAuth storage migration

Deploy migration yang membuat tabel private OAuth:

```bash
supabase db push
```

Tabel `oauth_clients`, `oauth_codes`, dan `oauth_tokens` memakai RLS tanpa policy, sehingga hanya service role Edge Function yang bisa membaca/menulis.

### 3. Deploy Edge Function

```bash
supabase functions deploy mcp-server
```

Pastikan `supabase/config.toml` tetap berisi:

```toml
[functions.mcp-server]
verify_jwt = false
```

Auth dilakukan oleh handler MCP sendiri: legacy `X-MCP-Secret`, OAuth bearer token Claude Web, atau Supabase session bearer token untuk dashboard.

### 4. Paste this into Claude Web

Di Claude Web → **Settings** → **Connectors** → **Add custom connector**:

- Connector name: `firecrawl-kw`
- Remote MCP server URL: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server`
- OAuth Client ID: value dari `CLAUDE_OAUTH_CLIENT_ID`, contoh `firecrawl-kw-claude`
- OAuth Client Secret: value dari `CLAUDE_OAUTH_CLIENT_SECRET`

Saat Claude membuka authorization page, masukkan `MCP_MASTER_PASSWORD`. Setelah authorize, Claude akan exchange authorization code + PKCE ke `/token`, menyimpan bearer token, lalu memakai bearer token itu untuk `initialize`, `tools/list`, dan `tools/call`.

### 5. OAuth endpoints exposed by the MCP function

- Protected resource metadata: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server/.well-known/oauth-protected-resource`
- Authorization server metadata: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server/.well-known/oauth-authorization-server`
- Dynamic client registration: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server/register`
- Authorization endpoint: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server/authorize`
- Token endpoint: `https://pvbkvntrofpmcwgmmacv.supabase.co/functions/v1/mcp-server/token`

Unauthenticated MCP JSON-RPC POST requests return `401` with `WWW-Authenticate: Bearer resource_metadata="..."` so Claude can discover OAuth correctly on Supabase Edge Functions.

### 6. Claude Web test checklist

1. Add connector with the exact URL and OAuth Client ID/Secret above.
2. Confirm Claude redirects to the MCP authorization page.
3. Enter `MCP_MASTER_PASSWORD` and authorize.
4. Confirm connector status becomes connected.
5. In a Claude chat, enable the connector from the tools/connectors menu.
6. Ask Claude to list available tools or run a simple `search` tool call.
7. Check Supabase Edge Function logs for:
   - `[oauth] authorize success client_id=`
   - `[oauth] token issued client_id=`
   - `[mcp] initialize id=`
   - `[mcp] tools/call name=`
8. Send an unauthenticated POST to the MCP URL and confirm it returns `401`.
9. Test an existing local MCP client with the rotated `X-MCP-Secret` header.

## Local MCP stdio bridge

Selain HTTP Edge Function, repo ini menyediakan bridge stdio lokal di `scripts/mcp-stdio-proxy.mjs`. Bridge ini membuat project bisa dipakai oleh MCP client yang memakai format `command` / `args` / `env`. Proses lokal membaca JSON-RPC dari stdin/stdout, lalu meneruskan request MCP ke Supabase Edge Function `mcp-server`.

Contoh konfigurasi MCP client:

```jsonc
{
  "personal-firecrawl": {
    "command": "node",
    "args": ["D:\\Project_Gabut\\firecrawl-kw\\scripts\\mcp-stdio-proxy.mjs"],
    "env": {
      "MCP_ENDPOINT": "https://<project-ref>.supabase.co/functions/v1/mcp-server",
      "SUPABASE_ANON_KEY": "<supabase-anon-key>",
      "MCP_SECRET": "<optional-mcp-secret>",
      "GITHUB_TOKEN": "<optional-github-token>",
      "SUPABASE_ACCESS_TOKEN": "<optional-user-access-token>"
    }
  }
}
```

Alternatif jika ingin endpoint dibuat otomatis dari URL Supabase:

```jsonc
{
  "personal-firecrawl": {
    "command": "node",
    "args": ["D:\\Project_Gabut\\firecrawl-kw\\scripts\\mcp-stdio-proxy.mjs"],
    "env": {
      "SUPABASE_URL": "https://<project-ref>.supabase.co",
      "SUPABASE_ANON_KEY": "<supabase-anon-key>",
      "MCP_SECRET": "<optional-mcp-secret>"
    }
  }
}
```

Variabel environment yang didukung bridge:

- `MCP_ENDPOINT`: URL lengkap Edge Function MCP. Jika kosong, bridge memakai `SUPABASE_URL` atau `VITE_SUPABASE_URL` + `/functions/v1/mcp-server`.
- `SUPABASE_ANON_KEY` atau `VITE_SUPABASE_PUBLISHABLE_KEY`: dikirim sebagai header `apikey`.
- `SUPABASE_ACCESS_TOKEN` atau `AUTHORIZATION_BEARER_TOKEN`: dikirim sebagai `Authorization: Bearer ...`.
- `MCP_SECRET` atau `X_MCP_SECRET`: dikirim sebagai `X-MCP-Secret`.
- `GITHUB_TOKEN` atau `X_GITHUB_TOKEN`: dikirim sebagai `X-GitHub-Token`.
- `MCP_REQUEST_TIMEOUT_MS`: timeout request remote, default `120000`.
- `MCP_STDIO_DEBUG`: set `1` atau `true` untuk log debug ke stderr.

Untuk smoke test lokal:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}\n' | node scripts/mcp-stdio-proxy.mjs
```

## Docs

- Product requirements: [PRD.md](./PRD.md)
- Reference PRD format: [contoh_prd.md](./contoh_prd.md)
- Prior PRD conversation export: [Membuat PRD Firecrawl MCP.md](./Membuat%20PRD%20Firecrawl%20MCP.md)
- Refactor and recency plans: [docs/superpowers](./docs/superpowers)
