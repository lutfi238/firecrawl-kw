# Firecrawl KW Maintenance Hardening Implementation Plan

> **For agentic workers:** Execute inline in the current checkout. Do not create commits or publish/deploy until the complete verification gate passes.

**Goal:** Complete the outstanding repository maintenance priorities while preserving the current major framework versions.

**Architecture:** Derive public metadata from backend definitions, add a database-backed Edge rate limiter, clean component/module boundaries, lazy-load routes, and make verification reproducible in GitHub Actions and Playwright.

**Tech Stack:** React 18, TypeScript, Vite 6, Vitest, Playwright, Supabase Edge Functions, PostgreSQL, GitHub Actions, npm.

## Global Constraints

- Keep React 18, Vite 6, React Router 6, Tailwind CSS 3, and Zod 3.
- Preserve hosted backend auth modes and custom MCP headers.
- Never expose or log secret values.
- Keep normal-user documentation free of unnecessary Supabase implementation details.
- Do not publish or deploy until all local checks pass.

### Task 1: Tool metadata and documentation

**Files:** `supabase/functions/mcp-server/tools/definitions.ts`, `supabase/functions/mcp-server/index.ts`, `src/test/mcp/toolDefinitions.test.ts`, `README.md`, `PRD.md`, `AGENTS.md`, `index.html`

- [ ] Add a failing test asserting the backend exposes 21 definitions and `api_key_manage` exactly once.
- [ ] Export a tool-count helper and use it in the health response.
- [ ] Update user-facing and agent documentation to distinguish 21 backend tools from 20 tester tools.
- [ ] Run the focused test.

### Task 2: Database-backed rate limiting

**Files:** `supabase/migrations/20260718000000_mcp_rate_limits.sql`, `supabase/functions/mcp-server/security/rateLimit.ts`, `supabase/functions/mcp-server/index.ts`, `src/test/mcp/rateLimit.test.ts`, `README.md`, `AGENTS.md`

- [ ] Write failing tests for allowed, rejected, and fail-open RPC outcomes.
- [ ] Add the atomic SQL bucket/RPC migration with service-role-only execution.
- [ ] Implement per-user MCP/REST and per-IP mutable OAuth enforcement.
- [ ] Return HTTP 429 with retry metadata and document environment controls.
- [ ] Run focused rate-limit and auth tests.

### Task 3: Zero-warning lint cleanup

**Files:** affected hook components, `src/components/SourceBadge.tsx`, `src/lib/sourceMeta.ts`, and shadcn primitive modules.

- [ ] Fix missing/unstable hook dependencies.
- [ ] Move or stop exporting non-component utilities from component modules.
- [ ] Run ESLint with `--max-warnings=0`.

### Task 4: Route and vendor bundle splitting

**Files:** `src/App.tsx`, `vite.config.ts`, `src/test/AppLazyRoutes.test.tsx`

- [ ] Add a route-loading regression assertion.
- [ ] Lazy-load route pages behind an accessible Suspense fallback.
- [ ] Group stable vendor families in Vite.
- [ ] Build and compare chunk output.

### Task 5: CI and Playwright smoke coverage

**Files:** `.github/workflows/ci.yml`, `playwright.config.ts`, `playwright-fixture.ts`, `e2e/smoke.spec.ts`, `package.json`, `README.md`, `AGENTS.md`

- [ ] Configure standard Playwright with a Vite web server.
- [ ] Test the frontend entry state and public hosted health endpoint.
- [ ] Add `test:e2e` and a CI workflow covering install, audit, lint, tests, build, and smoke tests.
- [ ] Run Playwright locally in Chromium.

### Task 6: MCP package release preparation

**Files:** `packages/firecrawl-kw-mcp/package.json`, `packages/firecrawl-kw-mcp/README.md`, `src/test/mcpPackage.test.ts`

- [ ] Add a failing metadata/version assertion.
- [ ] Bump to `0.1.1` and add OSS repository metadata.
- [ ] Run package tests and `npm pack --dry-run --json`.
- [ ] Publish only if `npm whoami` succeeds; otherwise report the authentication blocker exactly.

### Task 7: Full verification

- [ ] Run clean install and both audits.
- [ ] Run zero-warning lint, all unit tests, production build, and Playwright.
- [ ] Validate SQL and Edge source, inspect the complete diff, and confirm no generated artifacts or secrets were added.
