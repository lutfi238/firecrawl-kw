# MCP Server Staged Refactor Design

## Summary

This design proposes a staged refactor of `supabase/functions/mcp-server/index.ts` to improve long-term maintainability, reduce feature delivery cost, and make future optimizations safer. The refactor avoids a full rewrite. Instead, it incrementally extracts cohesive modules while preserving the current MCP JSON-RPC behavior, SSE responses, tool contracts, and frontend integration.

## Goals

- Reduce maintenance cost of the MCP backend.
- Make it easier to add new tools and new background job types.
- Improve testability by isolating pure utilities and infrastructure code.
- Preserve current frontend/backend request and response contracts.
- Create a safer foundation for later performance optimizations.

## Non-goals

- No full rewrite of the MCP server.
- No protocol redesign.
- No intentional behavior changes to tool outputs in the first refactor phases.
- No large frontend redesign as part of this work.

## Current problems

The current `supabase/functions/mcp-server/index.ts` combines too many responsibilities in one file:

- JSON-RPC transport handling
- CORS and request validation
- auth and settings lookup
- AI request building and SSE streaming
- web scraping helpers
- URL normalization and Google News resolution
- background crawl and agent job orchestration
- tool dispatch and tool-specific business logic

This creates several issues:

- high regression risk for unrelated changes
- difficult onboarding for future contributors
- poor unit-test surface
- expensive feature additions because every change touches a central file
- higher chance of subtle coupling between tools, jobs, and transport logic

## Recommended architecture

Target structure under `supabase/functions/mcp-server/`:

- `index.ts`
  - Deno/Hono entrypoint only
  - request routing only
  - delegates JSON-RPC requests to handlers
- `transport/`
  - `cors.ts`
  - `jsonRpc.ts`
  - `sse.ts`
- `auth/`
  - `mcpSecret.ts`
  - `userContext.ts`
  - `userSettings.ts`
- `ai/`
  - `client.ts`
  - `stream.ts`
  - `prompts.ts`
- `scrapers/`
  - `htmlToMarkdown.ts`
  - `urlUtils.ts`
  - `googleNews.ts`
- `jobs/`
  - `crawlJobs.ts`
  - `agentJobs.ts`
  - `jobStatus.ts`
- `tools/`
  - `registry.ts`
  - tool handler modules such as `search.ts`, `scrape.ts`, `chat.ts`, `crawl.ts`
- `shared/`
  - `constants.ts`
  - `types.ts`
  - `errors.ts`

## Responsibility boundaries

### Transport layer

The transport layer should only know how to:

- parse JSON-RPC requests
- emit JSON-RPC responses
- emit SSE responses
- apply CORS headers
- map thrown errors to structured JSON-RPC errors

It should not contain tool-specific or scraping-specific logic.

### Auth/settings layer

This layer should centralize:

- `X-MCP-Secret` validation
- authenticated user resolution from Supabase headers
- per-user settings retrieval
- any shared request context construction

This reduces repeated auth logic and makes future hardening easier.

### AI layer

The AI layer should centralize:

- standard provider headers
- non-streaming AI calls
- streaming AI calls
- model/token defaults
- prompt assembly helpers

This avoids prompt/network/config scattering across handlers.

### Scraper/helper layer

This layer should contain pure or near-pure helpers:

- HTML to markdown conversion
- URL normalization/resolution
- same-origin extraction
- Google News URL resolution helpers

These are the safest first candidates for extraction because they have low coupling.

### Jobs layer

This layer should own:

- job creation/update helpers
- crawl background processing
- agent background processing
- job status reading

This makes background workflows easier to test and evolve.

### Tool layer

Each tool should be handled by a dedicated module or function. A registry should map tool name to handler. This replaces the large `switch` statement and makes tool addition predictable.

## Staged implementation strategy

### Phase 1: extract pure helpers

Move low-risk, mostly pure helpers out of `index.ts`:

- HTML to markdown logic
- URL resolution helpers
- Google News helper functions
- shared constants and types

Expected outcome:

- smaller server file
- easy first tests
- minimal behavior risk

### Phase 2: extract transport and infra

Move shared infrastructure logic out of `index.ts`:

- CORS helpers
- JSON-RPC response builders
- SSE utilities
- user settings helpers
- auth helpers
- AI client helpers

Expected outcome:

- core request handling becomes easier to read
- protocol behavior is centralized
- later handlers can stay focused on domain behavior

### Phase 3: extract jobs

Move background processing logic into dedicated modules:

- crawl job processor
- agent job processor
- job status helper

Expected outcome:

- job logic becomes isolated
- asynchronous flows become easier to reason about
- job-specific testing becomes practical

### Phase 4: convert tool dispatch to registry

Replace the central `switch` with a registry-based dispatch mechanism.

Expected outcome:

- adding a tool becomes adding a handler module plus registry entry
- tool contracts remain explicit
- risk of merge conflicts drops because tools are less centralized

### Phase 5: post-refactor optimizations

After the structure is stable, apply optimizations that are safer in a modular design:

- reduce aggressive frontend polling
- move log aggregation to SQL or RPC
- reduce repeated auth/session/header overhead on the frontend
- improve crawl concurrency with bounded parallelism
- unify SSE parsing and streaming contracts

## Data flow design

### JSON-RPC request path

1. `index.ts` receives request.
2. transport parses JSON-RPC body.
3. auth layer validates MCP secret and resolves request context.
4. tool registry resolves the handler.
5. tool handler uses AI, jobs, or scrapers modules as needed.
6. transport serializes JSON-RPC result or error.

### Streaming request path

1. handler decides streaming vs non-streaming.
2. AI streaming module emits normalized SSE chunks.
3. transport applies SSE headers and returns `ReadableStream`.
4. frontend consumes a more predictable event format.

### Background jobs path

1. tool handler creates a job record.
2. jobs module receives execution request.
3. `EdgeRuntime.waitUntil(...)` schedules processing.
4. job module updates status/output consistently.
5. status handler exposes job state to frontend.

## Testing strategy

The refactor should follow behavior-preserving TDD where practical.

### Utility tests first

Add tests for extracted pure helpers before moving behavior:

- markdown conversion expectations
- URL normalization and same-origin filtering
- Google News extraction edge cases

### Module-level tests

After extraction, add focused tests for:

- JSON-RPC response formatting
- SSE event formatting
- tool registry dispatch
- job status shaping

### Regression checks

For each phase:

- run the smallest relevant tests first
- run `npm run lint` after TS changes that affect the frontend
- run broader verification if frontend/backend contracts were touched

## Error handling design

The refactor should standardize error behavior:

- domain modules throw typed or structured errors where useful
- transport maps them to JSON-RPC error responses
- SSE path emits error events in a consistent format
- secrets and tokens must not be exposed in logs or error bodies

## Migration and rollout approach

This should be an in-place refactor over multiple small commits.

Rules:

- preserve existing public behavior until covered by tests and intentionally changed later
- avoid mixing architecture refactor with feature additions
- keep each phase independently verifiable
- stop and verify frontend compatibility whenever MCP payload shape is touched

## Risks and mitigations

### Risk: contract drift between frontend and backend
Mitigation:

- preserve `src/hooks/useMCPServer.ts` expectations during early phases
- verify JSON-RPC result/error shapes after each extraction
- isolate transport helpers before changing handler internals

### Risk: accidental streaming regressions
Mitigation:

- centralize SSE formatting
- add tests around stream event payload structure where feasible
- avoid changing frontend parser until backend stream format is stabilized

### Risk: refactor grows into rewrite
Mitigation:

- keep the staged plan strict
- extract existing logic first before redesigning internals
- defer performance tuning until after module boundaries are in place

## Success criteria

This refactor is successful when:

- `supabase/functions/mcp-server/index.ts` becomes primarily an entrypoint/router
- tool handlers are modular and registry-based
- utility and job logic live in dedicated files
- adding a new tool no longer requires editing a large multi-purpose file
- the existing frontend continues to work without contract regressions
- later performance optimizations can be applied per module rather than in one central file

## Recommended next step

Write a detailed implementation plan that executes this refactor in small TDD-guided phases, starting with pure helper extraction and regression-safe tests.
