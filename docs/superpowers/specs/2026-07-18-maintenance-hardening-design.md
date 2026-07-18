# Firecrawl KW Maintenance Hardening Design

## Goal

Bring the repository back to a reproducible, secure, documented, and continuously verified state without migrating the application to new major framework versions.

## Scope

- Keep React 18, Vite 6, React Router 6, Tailwind CSS 3, and Zod 3.
- Make the backend tool count authoritative: 21 MCP tools, of which 20 appear in the general Tool Tester and `api_key_manage` is exposed through the dedicated MCP Secrets page.
- Protect authenticated MCP/REST calls and mutable OAuth endpoints with a database-backed fixed-window rate limit.
- Preserve handler-level authentication because Supabase JWT verification remains disabled for the Edge Functions.
- Eliminate all ESLint warnings without globally disabling the hook or Fast Refresh rules.
- Split route bundles and stable vendor groups so the initial application chunk is materially smaller.
- Add GitHub Actions and Playwright smoke coverage for clean install, unit tests, lint, build, the configuration gate, and the hosted health endpoint.
- Prepare `firecrawl-kw-mcp@0.1.1` with complete OSS package metadata. Publish only when npm authentication is available.

## Architecture

### Tool metadata

`getToolDefinitions({}, null).length` is the backend source of truth for the health response. Documentation distinguishes the 21 backend MCP tools from the 20 tools shown in the general-purpose tester.

### Rate limiting

A SQL migration adds an internal `mcp_rate_limits` table and an atomic `consume_mcp_rate_limit` RPC. The Edge Function calls the RPC with the service-role key. Authenticated MCP and REST requests use a per-user bucket (default 120 requests per 60 seconds); mutable OAuth requests use a per-IP bucket (default 30 requests per 60 seconds). Limits are configurable through `MCP_RATE_LIMIT_REQUESTS_PER_MINUTE` and `MCP_OAUTH_RATE_LIMIT_REQUESTS_PER_MINUTE`.

The limiter fails open only when its backing service is unavailable, logs the failure, and never logs credentials. A rejected request returns HTTP 429, `Retry-After`, and standard rate-limit headers.

### Frontend maintenance

Route pages load through `React.lazy` and `Suspense`. Vite groups stable React, Radix, Supabase, chart, and icon dependencies into vendor chunks. Hook dependency warnings are fixed at their source. Fast Refresh warnings are removed by keeping non-component exports out of component modules rather than suppressing the rule.

### Automation

GitHub Actions runs `npm ci`, zero-warning lint, unit tests, build, Playwright Chromium installation, and smoke tests. Playwright starts the Vite server and accepts either the hosted-backend configuration gate or the unauthenticated sign-in screen, allowing the same smoke test to run with or without local Vite environment files.

### Package release

The stdio proxy package advances to `0.1.1` and declares author, repository, homepage, bugs, and MIT metadata. `npm pack --dry-run` must include the license. Registry publication is attempted only after all local verification and requires a valid npm login.

## Verification

- `npm ci`
- `npm audit` and `npm audit --omit=dev`
- `npm run lint -- --max-warnings=0`
- `npm run test`
- `npm run build`
- `npm run test:e2e`
- `npm pack --dry-run --json` inside `packages/firecrawl-kw-mcp`
- Supabase migration and function source validation before any deployment

