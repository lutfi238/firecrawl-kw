# Firecrawl KW Refactor Plan

This is the living plan for the refactor discussed in chat. Keep this file updated after every completed step so future/compacted sessions can resume without losing context.

## Current Context

- Project: Vite + React + TypeScript frontend, Supabase backend, Remote MCP server in Supabase Edge Functions.
- Frontend hosting: Lovable syncs from GitHub `main` and hosts the web UI.
- Backend hosting: Supabase Edge Functions must be deployed separately with Supabase CLI unless an external integration deploys them.
- Current remote MCP URL: `https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server`.
- Current product direction: personal/self-hostable MCP dashboard first, with a future-friendly “bring your own Supabase/MCP backend” architecture.

## Main Product Goal

Refactor the app from a single fixed backend into a flexible personal/BYOB backend MCP platform:

```text
Hosted frontend UI
  ↓
User-selected Supabase project / MCP endpoint
  ↓
User-owned Edge Functions, database, settings, secrets, API keys
  ↓
User-owned AI provider / GitHub Models / renderer / unblocker
```

The owner should not need to host other users’ secrets/resources unless intentionally turning this into SaaS later.

## Key Decisions From Conversation

1. **GitHub login should not be used only for identity if it adds no product value.**
   - GitHub login was originally added to try to use Copilot models.
   - Copilot login is not the right general AI provider path.

2. **GitHub Models is the correct replacement for the Copilot-provider idea.**
   - API base: `https://models.github.ai/inference`
   - Catalog: `https://models.github.ai/catalog/models`
   - Required permission/token: `models:read` via fine-grained PAT or GitHub App.
   - GitHub Models is not unlimited/free forever; it has quotas/rate limits.

3. **GitHub App is worth exploring, but only after PAT-based GitHub Models works.**
   - Need to validate GitHub App `models:read` token works with `models.github.ai`.
   - GitHub App is better than classic OAuth if users should install/use their own GitHub account/org permissions.

4. **MCP auth should be layered.**
   - Dashboard: Supabase session bearer token.
   - Claude Web / custom remote MCP clients: OAuth.
   - Legacy/local MCP clients: `X-MCP-Secret`.
   - Future general use: OAuth tokens should be linked to Supabase `user_id`.

5. **Lovable deploys frontend only.**
   - GitHub push updates the Lovable web UI.
   - Supabase Edge Function changes require `supabase functions deploy ...`.
   - Database migrations require `supabase db push`.

## Already Completed In This Session

### Claude Web OAuth / MCP Auth Work

- Added/updated Remote MCP OAuth support in the Supabase Edge Function.
- Existing `X-MCP-Secret` header support was preserved for clients that can send custom headers.
- Added support for OAuth bearer tokens for Claude Web/custom connectors.
- Added support for Supabase session bearer tokens so the web dashboard no longer needs to send `X-MCP-Secret`.
- Added/updated OAuth endpoints:
  - protected resource metadata
  - authorization server metadata
  - dynamic client registration
  - authorize page
  - token endpoint
- Added discovery path fallbacks for Supabase Edge Function path issues.
- Added logs for auth/initialize/tool calls.

Touched files:

- `supabase/functions/mcp-server/auth/oauth.ts`
- `supabase/functions/mcp-server/auth/mcpSecret.ts`
- `supabase/functions/mcp-server/index.ts`
- `supabase/migrations/20260512102413_138a1deb-5d1f-4e2d-8920-67b69d6a671f.sql` existed from pull and provides OAuth tables.

### Frontend MCP Secret Cleanup

- Removed browser/dashboard sending of `X-MCP-Secret`.
- Removed old Settings UI that stored `mcp_secret` in user settings.
- Replaced it with an informational MCP auth card explaining backend env-only auth.

Touched files:

- `src/hooks/useMCPServer.ts`
- `src/pages/Settings.tsx`

### README Setup Docs

- Added Claude Web custom connector setup instructions.
- Added OAuth env vars and secret rotation instructions.
- Added deploy checklist and test checklist.

Touched file:

- `README.md`

### Verification Already Run

- Targeted ESLint on changed files passed:
  - `src/hooks/useMCPServer.ts`
  - `src/pages/Settings.tsx`
  - `supabase/functions/mcp-server/auth/oauth.ts`
  - `supabase/functions/mcp-server/auth/mcpSecret.ts`
  - `supabase/functions/mcp-server/index.ts`
- `npm run build` passed.
- Full `npm run lint` still fails due to pre-existing unrelated lint errors in other files.

## Immediate Deployment Notes

After backend changes, deploy manually to Supabase:

```text
supabase db push
supabase functions deploy mcp-server
```

Rotate/set backend-only secrets:

```text
supabase secrets set MCP_SECRET="<new-random-legacy-mcp-secret>"
supabase secrets set MCP_MASTER_PASSWORD="<new-random-consent-password>"
supabase secrets set CLAUDE_OAUTH_CLIENT_ID="firecrawl-kw-claude"
supabase secrets set CLAUDE_OAUTH_CLIENT_SECRET="<new-random-oauth-client-secret>"
```

Claude Web connector values:

```text
Connector name: firecrawl-kw
Remote MCP server URL: https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server
OAuth Client ID: value of CLAUDE_OAUTH_CLIENT_ID, e.g. firecrawl-kw-claude
OAuth Client Secret: value of CLAUDE_OAUTH_CLIENT_SECRET
```

## Refactor Roadmap

## Phase 1 — GitHub Models Provider

Priority: high. This fixes the original reason GitHub/Copilot login was added.

### Goal

Replace the misleading/broken GitHub Copilot AI provider idea with official GitHub Models support.

### Tasks

1. Update AI provider list in `src/pages/Settings.tsx`:
   - Remove/rename “GitHub Copilot”.
   - Add “GitHub Models”.
   - Base URL: `https://models.github.ai/inference`.
   - Default model: `openai/gpt-4.1` or another catalog model.

2. Update AI request headers when provider/base URL is GitHub Models:
   - `Accept: application/vnd.github+json`
   - `X-GitHub-Api-Version: 2026-03-10`
   - `Authorization: Bearer <token>`
   - `Content-Type: application/json`

3. Add model catalog fetch:
   - `GET https://models.github.ai/catalog/models`
   - token must have `models:read`.
   - Return/display `id`, `name`, `publisher`, `summary`, `capabilities`, `limits`, `rate_limit_tier`.

4. Add “Fetch GitHub Models” button in Settings when provider is GitHub Models.

5. Document clearly:
   - GitHub Models is different from Copilot.
   - It is not unlimited/free forever.
   - Recommended initial auth is fine-grained PAT or token with `models:read`.

### Acceptance Criteria

- User can select GitHub Models provider.
- User can paste a GitHub token with `models:read`.
- App can fetch model catalog.
- AI chat/extract can call GitHub Models via `/inference/chat/completions`.
- Copilot provider wording no longer confuses the user.

## Phase 2 — Runtime Backend Configuration / BYO Supabase

Priority: high after GitHub Models provider.

### Goal

Allow the hosted frontend to connect to either the default env backend or a user-provided Supabase/MCP backend.

### Tasks

1. Create `src/lib/backendConfig.ts`:
   - `getBackendConfig()`
   - `saveBackendConfig(config)`
   - `clearBackendConfig()`
   - `hasValidBackendConfig()`
   - derive MCP endpoint from Supabase URL if missing.

2. Create `src/lib/supabaseRuntime.ts`:
   - runtime Supabase client factory.
   - use env client by default.
   - use localStorage custom backend config when selected.
   - cache client per config.

3. Add `src/pages/BackendSetup.tsx`:
   - Supabase URL field.
   - Supabase anon/publishable key field.
   - MCP endpoint URL field.
   - test connection button.
   - save/reset buttons.

4. Add `BackendConfigGate` before `AuthGate`.

5. Update hooks/components that directly use static generated Supabase client:
   - `src/App.tsx`
   - `src/hooks/useSettings.ts`
   - `src/hooks/useRequestLogs.ts`
   - `src/hooks/useMCPServer.ts`
   - any other direct `supabase` import where runtime backend matters.

6. Add backend indicator in dashboard/settings:
   - Mode: default/custom.
   - Supabase host.
   - MCP endpoint.

### Acceptance Criteria

- Existing Lovable deployment still works with env vars.
- User can switch to their own Supabase URL/anon key/MCP endpoint at runtime.
- Runtime config is stored only in localStorage.
- No service-role keys or private secrets are stored in browser.

## Phase 3 — Deployment Wizard / Self-Hosting UX

Priority: medium.

### Goal

Make it easy for users to deploy their own Supabase backend and then connect the hosted frontend to it.

### Tasks

1. Add `src/pages/DeploymentGuide.tsx`.
2. Show steps:
   - create Supabase project.
   - link Supabase CLI.
   - run migrations.
   - deploy functions.
   - set secrets.
   - copy backend config into app.
3. Add health checks:
   - MCP health.
   - OAuth metadata.
   - tools/list with auth.
4. Document Lovable-vs-Supabase deployment distinction.

### Acceptance Criteria

- New user can follow the guide to bring their own Supabase/MCP backend.
- Guide does not ask for storing service-role key in frontend.

## Phase 4 — Server-Side AI Provider Testing

Priority: medium/security.

### Goal

Avoid repeatedly testing provider API keys directly from browser after save.

### Tasks

1. Add backend test endpoint/tool for AI provider.
2. Settings page calls backend test endpoint.
3. Secrets remain in user-owned Supabase settings and are used server-side.
4. Add masking/clear/replace flows for sensitive settings.

### Acceptance Criteria

- Provider keys are not exposed by direct browser requests after saving.
- Settings can still show connected/failed state.

## Phase 5 — MCP OAuth User Binding

Priority: medium/long-term general use.

### Goal

Make OAuth tokens user-aware so Claude Web and other clients use the correct user settings/logs/jobs.

### Tasks

1. Migration:
   - add `user_id` to `oauth_codes`.
   - add `user_id` to `oauth_tokens`.
2. Change `/authorize`:
   - for personal mode, `MCP_MASTER_PASSWORD` can remain.
   - for user mode, require Supabase session and show consent screen.
3. Change `validateBearer()` to return:
   - `client_id`
   - `user_id`
   - `scope`
4. Update settings/logs/jobs loading to use OAuth `user_id`.

### Acceptance Criteria

- OAuth token belongs to a user.
- Claude Web can use that user’s settings.
- Logs/jobs are attributed to that user.
- Tokens can be revoked per user/client later.

## Phase 6 — GitHub App Support for GitHub Models

Priority: after Phase 1 proves GitHub Models PAT flow.

### Goal

Allow users to connect a GitHub App instead of pasting a PAT.

### Tasks

1. Validate GitHub App `models:read` works with `models.github.ai`.
2. Add backend-only env config:
   - `GITHUB_APP_ID`
   - `GITHUB_APP_PRIVATE_KEY`
   - `GITHUB_APP_CLIENT_ID`
   - `GITHUB_APP_CLIENT_SECRET`
3. Add Edge Function for GitHub App auth/install callback.
4. Store installation/user mapping in Supabase.
5. Mint GitHub App token server-side for GitHub Models calls.
6. Add UI:
   - use PAT
   - connect GitHub App

### Acceptance Criteria

- User can connect GitHub App.
- GitHub Models can be called without pasted PAT.
- Usage belongs to user/org installation where supported.

## Phase 7 — Documentation Rewrite

Priority: ongoing.

### Goal

Make README/docs explain the final mental model clearly.

### Sections To Add/Refine

1. What this project is.
2. Architecture: Lovable frontend + Supabase backend.
3. Modes:
   - personal default backend.
   - bring your own Supabase.
   - self-host.
4. Claude Web OAuth connector setup.
5. GitHub Models setup.
6. AI providers.
7. Renderer/unblocker setup.
8. Secret handling.
9. Troubleshooting.

## Backlog / Later Ideas

- Add provider-specific AI adapter abstraction instead of baseUrl string checks.
- Add token revocation UI for OAuth MCP connectors.
- Add organization attribution support for GitHub Models org endpoint.
- Add FlareSolverr/unblocker provider support for Cloudflare-protected sites.
- Add stricter audit logging for auth failures and tool calls.
- Add tests for OAuth token exchange and challenge metadata responses.

## Progress Log

Use this section for every future completed step. Format:

```text
YYYY-MM-DD — short summary
- Files changed:
- Verification:
- Notes:
```

### 2026-05-12 — Created living refactor plan

- Files changed:
  - `plan.md`
- Verification:
  - Not run; documentation-only change.
- Notes:
  - This file replaces the previous chat export purpose with an actionable plan and progress log.
  - Future agents should update this section after every completed implementation step.

### 2026-05-12 — Claude Web OAuth and frontend MCP secret cleanup completed before plan file creation

- Files changed:
  - `supabase/functions/mcp-server/auth/oauth.ts`
  - `supabase/functions/mcp-server/auth/mcpSecret.ts`
  - `supabase/functions/mcp-server/index.ts`
  - `src/hooks/useMCPServer.ts`
  - `src/pages/Settings.tsx`
  - `README.md`
- Verification:
  - Targeted ESLint passed on changed files.
  - `npm run build` passed.
  - Full `npm run lint` still fails due to unrelated pre-existing lint errors.
- Notes:
  - Needs Supabase deploy and secrets rotation before remote endpoint reflects changes.
  - Remote checked during conversation still returned `version: 2.0.0`, meaning changes were not deployed yet.

### 2026-05-12 — Phase 1 GitHub Models provider implemented

- Files changed:
  - `src/pages/Settings.tsx`
  - `supabase/functions/mcp-server/ai/settings.ts`
  - `supabase/functions/mcp-server/ai/chat.ts`
  - `supabase/functions/mcp-server/tools/callTool.ts`
  - `supabase/functions/mcp-server/tools/definitions.ts`
  - `supabase/functions/mcp-server/jobs/agentJobs.ts`
  - `README.md`
  - `plan.md`
- Verification:
  - Targeted ESLint passed on Phase 1 changed files.
  - `npm run build` passed.
- Notes:
  - Replaced misleading GitHub Copilot AI provider with GitHub Models.
  - Added provider-aware GitHub Models headers for AI calls.
  - Added Settings UI model catalog fetch from `https://models.github.ai/catalog/models`.
  - Added MCP tool `github_models_catalog`.
  - GitHub Models requires a token with `models:read` and is rate-limited, not unlimited free GPT.

### 2026-05-12 — Phase 2 runtime backend configuration implemented

- Files changed:
  - `src/lib/backendConfig.ts`
  - `src/lib/supabaseRuntime.ts`
  - `src/pages/BackendSetup.tsx`
  - `src/components/BackendConfigGate.tsx`
  - `src/App.tsx`
  - `src/hooks/useMCPServer.ts`
  - `src/hooks/useSettings.ts`
  - `src/hooks/useRequestLogs.ts`
  - `src/hooks/useUptimeLogs.ts`
  - `src/components/AuthGate.tsx`
  - `src/components/DashboardLayout.tsx`
  - `src/pages/Overview.tsx`
  - `src/pages/Settings.tsx`
  - `src/pages/AIChat.tsx`
  - `src/hooks/useToolExecutor.ts`
  - `src/hooks/useToolExecutorWithActivity.ts`
  - `src/types/tools.ts`
- Verification:
  - Targeted ESLint passed on Phase 2 changed frontend/runtime files.
  - `npm run build` passed.
- Notes:
  - Frontend can now use env default backend or custom runtime Supabase URL, anon key, and MCP endpoint stored in localStorage.
  - Added backend setup gate and Settings backend management card.
  - Static generated Supabase client file was not edited.
  - Browser still only stores anon/publishable key, never service-role keys.

### 2026-05-12 — Phase 3 deployment guide and Phase 4 backend AI provider test implemented

- Files changed:
  - `src/pages/DeploymentGuide.tsx`
  - `src/App.tsx`
  - `src/components/DashboardLayout.tsx`
  - `src/pages/Settings.tsx`
  - `src/pages/Overview.tsx`
  - `src/pages/AIChat.tsx`
  - `src/types/tools.ts`
  - `supabase/functions/mcp-server/tools/definitions.ts`
  - `supabase/functions/mcp-server/tools/callTool.ts`
  - `supabase/functions/mcp-server/index.ts`
  - `README.md`
- Verification:
  - Targeted ESLint passed on Phase 3/4 changed files.
  - `npm run build` passed.
- Notes:
  - Added Deploy page with Supabase CLI commands, secret checklist, Claude connector values, and health checks.
  - Added sidebar route `/deploy`.
  - Added `test_ai_provider` MCP tool so saved AI provider tests run from backend instead of the browser calling provider APIs directly.
  - Tool count is now 17 (`github_models_catalog` + `test_ai_provider` added).

### 2026-05-12 — Phase 5 OAuth user binding foundation implemented

- Files changed:
  - `supabase/migrations/20260512153000_add_oauth_user_binding.sql`
  - `supabase/functions/mcp-server/auth/oauth.ts`
  - `supabase/functions/mcp-server/auth/userSettings.ts`
  - `supabase/functions/mcp-server/jobs/batchScrape.ts`
- Verification:
  - Targeted ESLint passed on OAuth/user settings/job files.
  - `npm run build` passed.
- Notes:
  - Added nullable `user_id` columns to `oauth_codes` and `oauth_tokens`.
  - OAuth token validation now returns `user_id` and `scope` when present.
  - `getUserSettings()` can load settings for OAuth-bound users using service role server-side.
  - Async job creation now resolves OAuth-bound user IDs.
  - Current consent flow still uses `MCP_MASTER_PASSWORD`; it can bind OAuth tokens to `MCP_DEFAULT_USER_ID` env var. Full interactive Supabase-session consent UI is still future work.

### 2026-05-12 — Phase 6 GitHub App support documented, implementation blocked pending real GitHub App validation

- Files changed:
  - `README.md`
  - `plan.md`
- Verification:
  - Documentation-only phase entry; final build verification follows.
- Notes:
  - Added backend-only GitHub App secret names to README.
  - Full connect/install flow needs a real GitHub App with `models:read` and validation that installation/user tokens can call `models.github.ai`.
  - Current working GitHub Models flow remains token/PAT-based via Settings.

### 2026-05-12 — Phase 7 documentation refresh completed and final verification passed

- Files changed:
  - `README.md`
  - `plan.md`
- Verification:
  - Final targeted ESLint passed on all touched frontend and Supabase function files.
  - `npm run build` passed.
- Notes:
  - README now documents GitHub Models, Claude Web OAuth, BYO Supabase backend, deployment notes, and GitHub App future path.
  - Full `npm run lint` may still include older unrelated project lint warnings/errors not covered by the touched-file targeted lint.

## Open Questions / Follow-up

1. Create and validate an actual GitHub App with `models:read` before implementing the full GitHub App install/token minting flow.
2. Decide whether to fully replace GitHub dashboard auth with generic Supabase Auth/email login in a later pass.
3. Decide whether to add a proper interactive Supabase-session OAuth consent page instead of `MCP_MASTER_PASSWORD` + optional `MCP_DEFAULT_USER_ID`.
4. Run `supabase db push` and deploy Edge Functions before testing Claude Web against the remote endpoint.
