# MCP Server Staged Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the MCP server into smaller modules without changing current behavior, so future features and optimizations can be added safely.

**Architecture:** Preserve the current JSON-RPC and SSE contracts while extracting pure helpers, transport helpers, auth/settings helpers, job logic, and tool dispatch into focused modules. Execute in small, verifiable phases with tests around extracted logic before behavior changes.

**Tech Stack:** TypeScript, Vite, React, Vitest, Supabase Edge Functions, Deno, Hono

---

## File structure target

### Existing files to modify

- `supabase/functions/mcp-server/index.ts`
- `package.json`
- `vitest.config.ts` if test include patterns require adjustment

### New backend files to create

- `supabase/functions/mcp-server/shared/constants.ts`
- `supabase/functions/mcp-server/shared/types.ts`
- `supabase/functions/mcp-server/scrapers/htmlToMarkdown.ts`
- `supabase/functions/mcp-server/scrapers/urlUtils.ts`
- `supabase/functions/mcp-server/scrapers/googleNews.ts`
- `supabase/functions/mcp-server/transport/jsonRpc.ts`
- `supabase/functions/mcp-server/transport/sse.ts`
- `supabase/functions/mcp-server/auth/userSettings.ts`
- `supabase/functions/mcp-server/auth/mcpSecret.ts`
- `supabase/functions/mcp-server/ai/client.ts`
- `supabase/functions/mcp-server/jobs/jobStatus.ts`
- `supabase/functions/mcp-server/jobs/crawlJobs.ts`
- `supabase/functions/mcp-server/jobs/agentJobs.ts`
- `supabase/functions/mcp-server/tools/registry.ts`

### New test files to create

- `src/test/mcp/htmlToMarkdown.test.ts`
- `src/test/mcp/urlUtils.test.ts`
- `src/test/mcp/googleNews.test.ts`
- `src/test/mcp/jsonRpc.test.ts`
- `src/test/mcp/toolRegistry.test.ts`

---

### Task 1: Lock in helper behavior with tests

**Files:**
- Create: `src/test/mcp/htmlToMarkdown.test.ts`
- Create: `src/test/mcp/urlUtils.test.ts`
- Create: `src/test/mcp/googleNews.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing markdown helper test**

```ts
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../../supabase/functions/mcp-server/scrapers/htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, links, and strips script tags", () => {
    const html = `
      <html>
        <body>
          <script>alert("x")</script>
          <h1>Hello</h1>
          <p>Visit <a href="https://example.com">Example</a></p>
        </body>
      </html>
    `;

    expect(htmlToMarkdown(html)).toContain("# Hello");
    expect(htmlToMarkdown(html)).toContain("Visit [Example](https://example.com)");
    expect(htmlToMarkdown(html)).not.toContain("alert(\"x\")");
  });
});
```

- [ ] **Step 2: Write the failing URL utility test**

```ts
import { describe, expect, it } from "vitest";
import { extractLinks, resolveUrl, sameOrigin } from "../../../supabase/functions/mcp-server/scrapers/urlUtils";

describe("urlUtils", () => {
  it("keeps only same-origin resolved links and removes duplicates", () => {
    const html = `
      <a href="/a">A</a>
      <a href="https://example.com/a?x=1">A2</a>
      <a href="https://other.com/b">B</a>
    `;

    expect(resolveUrl("https://example.com/base", "/a")).toBe("https://example.com/a");
    expect(sameOrigin("https://example.com/x", "https://example.com/y")).toBe(true);
    expect(extractLinks(html, "https://example.com/root")).toEqual(["https://example.com/a"]);
  });
});
```

- [ ] **Step 3: Write the failing Google News helper test**

```ts
import { describe, expect, it } from "vitest";
import { decodeEscapedUrl, isGoogleNewsRssWrapper, normalizeResolvedUrl } from "../../../supabase/functions/mcp-server/scrapers/googleNews";

describe("googleNews helpers", () => {
  it("recognizes wrapper urls and rejects invalid article targets", () => {
    expect(isGoogleNewsRssWrapper("https://news.google.com/rss/articles/abc")).toBe(true);
    expect(decodeEscapedUrl("https:\\/\\/example.com\\/x\\u003da\\u0026b\\u003dc")).toBe("https://example.com/x=a&b=c");
    expect(normalizeResolvedUrl("https://example.com/article")).toBe("https://example.com/article");
    expect(normalizeResolvedUrl("https://google.com")).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -- src/test/mcp/htmlToMarkdown.test.ts src/test/mcp/urlUtils.test.ts src/test/mcp/googleNews.test.ts`

Expected: FAIL with module not found errors because the extracted helper modules do not exist yet.

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/test/mcp/htmlToMarkdown.test.ts src/test/mcp/urlUtils.test.ts src/test/mcp/googleNews.test.ts
 git commit -m "test: lock mcp helper behavior before extraction"
```

---

### Task 2: Extract scraper utility modules

**Files:**
- Create: `supabase/functions/mcp-server/scrapers/htmlToMarkdown.ts`
- Create: `supabase/functions/mcp-server/scrapers/urlUtils.ts`
- Create: `supabase/functions/mcp-server/scrapers/googleNews.ts`
- Modify: `supabase/functions/mcp-server/index.ts`
- Test: `src/test/mcp/htmlToMarkdown.test.ts`
- Test: `src/test/mcp/urlUtils.test.ts`
- Test: `src/test/mcp/googleNews.test.ts`

- [ ] **Step 1: Write minimal extracted implementations**

```ts
// supabase/functions/mcp-server/scrapers/htmlToMarkdown.ts
export function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}
```

```ts
// supabase/functions/mcp-server/scrapers/urlUtils.ts
export function sameOrigin(base: string, url: string): boolean {
  try {
    return new URL(base).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href="([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const resolved = resolveUrl(baseUrl, match[1]);
    if (resolved && sameOrigin(baseUrl, resolved) && !resolved.includes("#")) {
      links.push(resolved.split("?")[0]);
    }
  }

  return [...new Set(links)];
}
```

```ts
// supabase/functions/mcp-server/scrapers/googleNews.ts
const REJECTED_HOSTS = ["news.google.com", "google.com", "googleusercontent.com"];

export function isGoogleNewsRssWrapper(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "news.google.com" && parsed.pathname.includes("/rss/articles/");
  } catch {
    return false;
  }
}

export function decodeEscapedUrl(value: string): string {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\\//g, "/");
}

export function normalizeResolvedUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (REJECTED_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      return null;
    }
    if (parsed.pathname.length <= 1 && !parsed.search) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update `index.ts` to import the extracted helpers and remove duplicate inline definitions**

```ts
import { htmlToMarkdown } from "./scrapers/htmlToMarkdown.ts";
import { extractLinks, resolveUrl, sameOrigin } from "./scrapers/urlUtils.ts";
import { decodeEscapedUrl, isGoogleNewsRssWrapper, normalizeResolvedUrl } from "./scrapers/googleNews.ts";
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm run test -- src/test/mcp/htmlToMarkdown.test.ts src/test/mcp/urlUtils.test.ts src/test/mcp/googleNews.test.ts`

Expected: PASS

- [ ] **Step 4: Run lint to catch obvious TypeScript issues**

Run: `npm run lint`

Expected: PASS or only unrelated pre-existing warnings.

- [ ] **Step 5: Commit the extraction**

```bash
git add supabase/functions/mcp-server/scrapers/htmlToMarkdown.ts supabase/functions/mcp-server/scrapers/urlUtils.ts supabase/functions/mcp-server/scrapers/googleNews.ts supabase/functions/mcp-server/index.ts
 git commit -m "refactor: extract mcp scraper helpers"
```

---

### Task 3: Lock in JSON-RPC helper behavior with tests

**Files:**
- Create: `src/test/mcp/jsonRpc.test.ts`
- Create: `supabase/functions/mcp-server/transport/jsonRpc.ts`
- Test: `src/test/mcp/jsonRpc.test.ts`

- [ ] **Step 1: Write the failing JSON-RPC helper tests**

```ts
import { describe, expect, it } from "vitest";
import { createJsonRpcError, createJsonRpcResult } from "../../../supabase/functions/mcp-server/transport/jsonRpc";

describe("jsonRpc transport helpers", () => {
  it("creates a result payload with the original id", () => {
    expect(createJsonRpcResult(7, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("creates an error payload with the original id", () => {
    expect(createJsonRpcError(7, -32601, "Unknown method")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Unknown method" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/test/mcp/jsonRpc.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Write the minimal implementation**

```ts
// supabase/functions/mcp-server/transport/jsonRpc.ts
export function createJsonRpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function createJsonRpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/test/mcp/jsonRpc.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/test/mcp/jsonRpc.test.ts supabase/functions/mcp-server/transport/jsonRpc.ts
 git commit -m "refactor: add json-rpc transport helpers"
```

---

### Task 4: Move auth/settings helpers out of `index.ts`

**Files:**
- Create: `supabase/functions/mcp-server/auth/userSettings.ts`
- Create: `supabase/functions/mcp-server/auth/mcpSecret.ts`
- Modify: `supabase/functions/mcp-server/index.ts`

- [ ] **Step 1: Write minimal auth/settings modules by copying existing logic without changing behavior**

```ts
// supabase/functions/mcp-server/auth/userSettings.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function getUserSettings(authHeader: string | null): Promise<Record<string, string>> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !authHeader) return {};

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return {};

    const { data, error } = await supabase.from("settings").select("key, value").eq("user_id", user.id);
    if (error || !data) return {};

    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value ?? "";
    return map;
  } catch {
    return {};
  }
}
```

```ts
// supabase/functions/mcp-server/auth/mcpSecret.ts
import type { Context } from "hono";

export function checkMcpSecret(c: Context) {
  const expected = Deno.env.get("MCP_SECRET");
  if (!expected) return null;

  const actual = c.req.header("x-mcp-secret");
  if (actual === expected) return null;

  return c.json({ error: "Unauthorized" }, 401);
}
```

- [ ] **Step 2: Replace inline definitions in `index.ts` with imports**

```ts
import { checkMcpSecret } from "./auth/mcpSecret.ts";
import { getUserSettings } from "./auth/userSettings.ts";
```

- [ ] **Step 3: Run targeted tests and lint**

Run: `npm run test -- src/test/mcp/htmlToMarkdown.test.ts src/test/mcp/urlUtils.test.ts src/test/mcp/googleNews.test.ts src/test/mcp/jsonRpc.test.ts`

Expected: PASS

Run: `npm run lint`

Expected: PASS or unrelated warnings only.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mcp-server/auth/userSettings.ts supabase/functions/mcp-server/auth/mcpSecret.ts supabase/functions/mcp-server/index.ts
 git commit -m "refactor: extract mcp auth and settings helpers"
```

---

### Task 5: Extract job modules without changing orchestration behavior

**Files:**
- Create: `supabase/functions/mcp-server/jobs/jobStatus.ts`
- Create: `supabase/functions/mcp-server/jobs/crawlJobs.ts`
- Create: `supabase/functions/mcp-server/jobs/agentJobs.ts`
- Modify: `supabase/functions/mcp-server/index.ts`

- [ ] **Step 1: Copy the existing job functions into dedicated modules and export them**

```ts
// supabase/functions/mcp-server/jobs/jobStatus.ts
export async function checkJobStatus(authHeader: string | null, jobId: string): Promise<Record<string, unknown>> {
  // move existing implementation unchanged
  return {};
}
```

```ts
// supabase/functions/mcp-server/jobs/crawlJobs.ts
export async function processCrawlJob(jobId: string, args: Record<string, unknown>) {
  // move existing implementation unchanged
}
```

```ts
// supabase/functions/mcp-server/jobs/agentJobs.ts
export async function processAgentJob(
  jobId: string,
  args: Record<string, unknown>,
  aiSettings: { baseUrl: string; apiKey: string; model: string },
) {
  // move existing implementation unchanged
}
```

- [ ] **Step 2: Import the job helpers back into `index.ts` and remove the inline versions**

```ts
import { processAgentJob } from "./jobs/agentJobs.ts";
import { processCrawlJob } from "./jobs/crawlJobs.ts";
import { checkJobStatus } from "./jobs/jobStatus.ts";
```

- [ ] **Step 3: Run broad verification because backend orchestration was touched**

Run: `npm run test`

Expected: PASS

Run: `npm run lint`

Expected: PASS or only unrelated warnings.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mcp-server/jobs/jobStatus.ts supabase/functions/mcp-server/jobs/crawlJobs.ts supabase/functions/mcp-server/jobs/agentJobs.ts supabase/functions/mcp-server/index.ts
 git commit -m "refactor: extract mcp job modules"
```

---

### Task 6: Add tool registry and remove the large switch incrementally

**Files:**
- Create: `supabase/functions/mcp-server/tools/registry.ts`
- Create: `src/test/mcp/toolRegistry.test.ts`
- Modify: `supabase/functions/mcp-server/index.ts`

- [ ] **Step 1: Write the failing tool registry test**

```ts
import { describe, expect, it } from "vitest";
import { getToolHandler } from "../../../supabase/functions/mcp-server/tools/registry";

describe("tool registry", () => {
  it("returns the registered handler for a known tool", () => {
    const handler = () => Promise.resolve({ content: [{ type: "text", text: "ok" }] });
    const registry = { search: handler };

    expect(getToolHandler(registry, "search")).toBe(handler);
    expect(getToolHandler(registry, "missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/test/mcp/toolRegistry.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Write the minimal registry implementation**

```ts
// supabase/functions/mcp-server/tools/registry.ts
export type ToolHandler = (...args: unknown[]) => unknown;

export function getToolHandler(registry: Record<string, ToolHandler>, toolName: string) {
  return registry[toolName];
}
```

- [ ] **Step 4: Create a first registry in `index.ts` for a small subset of tools, leaving the rest in the switch temporarily**

```ts
const toolRegistry = {
  search: async (args: Record<string, unknown>) => {
    const results = await searchWeb(args.query as string, (args.maxResults as number) || 10);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  },
  scrape: async (args: Record<string, unknown>) => {
    const { markdown, title } = await scrapeUrl(args.url as string);
    return { content: [{ type: "text", text: `# ${title}\n\n${markdown}` }] };
  },
};
```

- [ ] **Step 5: Use the registry before the legacy switch**

```ts
const registeredHandler = getToolHandler(toolRegistry, name);
if (registeredHandler) {
  result = await registeredHandler(args);
  return c.json(createJsonRpcResult(id, result), 200, corsHeaders);
}
```

- [ ] **Step 6: Run tests and lint**

Run: `npm run test`

Expected: PASS

Run: `npm run lint`

Expected: PASS or unrelated warnings only.

- [ ] **Step 7: Commit**

```bash
git add src/test/mcp/toolRegistry.test.ts supabase/functions/mcp-server/tools/registry.ts supabase/functions/mcp-server/index.ts
 git commit -m "refactor: introduce mcp tool registry"
```

---

### Task 7: Finish cleanup and verify the new server shape

**Files:**
- Modify: `supabase/functions/mcp-server/index.ts`
- Modify: `docs/superpowers/specs/2026-04-21-mcp-server-staged-refactor-design.md` if implementation notes need to be updated

- [ ] **Step 1: Remove dead inline helpers from `index.ts` once all imports are in place**

```ts
// delete the old inline helper declarations that were moved to modules
// keep only entrypoint, routing, and high-level tool orchestration
```

- [ ] **Step 2: Ensure `index.ts` primarily reads as router + orchestration**

```ts
app.post("/*", async (c) => {
  const denied = checkMcpSecret(c);
  if (denied) return denied;

  // parse request
  // resolve handler
  // delegate work
  // serialize response
});
```

- [ ] **Step 3: Run full verification**

Run: `npm run test`

Expected: PASS

Run: `npm run lint`

Expected: PASS or unrelated warnings only.

Run: `npm run build`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mcp-server/index.ts docs/superpowers/specs/2026-04-21-mcp-server-staged-refactor-design.md
 git commit -m "refactor: complete staged mcp server modularization"
```

---

## Self-review

- Spec coverage: the plan covers pure helper extraction, infra extraction, jobs extraction, registry introduction, and final cleanup.
- Placeholder scan: the only intentional copy steps are for behavior-preserving extraction; during execution, exact copied implementations must be moved from the current file, not rewritten from memory.
- Type consistency: transport helpers, tool registry helpers, and module paths are named consistently across tasks.

## Notes for execution

- Do not combine architecture cleanup with new feature work.
- Do not change frontend transport contracts during early tasks.
- If any extracted module creates a Deno/Vitest compatibility problem, solve it with the smallest adapter necessary rather than redesigning the module.
