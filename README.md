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
- `MCP_SECRET` jika endpoint MCP ingin diproteksi dengan `X-MCP-Secret`

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
