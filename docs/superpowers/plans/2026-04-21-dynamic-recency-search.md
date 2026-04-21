# Dynamic Recency-Aware Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recency-sensitive chat queries dynamically prefer the newest available evidence without hardcoded years, while preserving the current tools-first search and synthesis flow.

**Architecture:** Add a shared recency-profile helper on the frontend and edge-function side, enrich recency-sensitive search queries at runtime, score aggregated search results by freshness before slicing, and tighten synthesis instructions so stale evidence is disclosed instead of being presented as current. Keep the existing `search -> optional search_and_scrape -> synthesis` orchestration and SSE behavior intact.

**Tech Stack:** React, TypeScript, Supabase Edge Functions, Deno, JSON-RPC MCP transport, existing DuckDuckGo/Bing News/Google News search helpers, Vitest.

---

## File Map

### Existing files to modify

- `src/lib/intentClassifier.ts`
  - Frontend routing heuristics for deciding when a query needs evidence and synthesis.
  - Will stop depending on hardcoded year keywords and instead use a reusable recency helper.

- `src/pages/AIChat.tsx`
  - Existing tools-first orchestration and synthesis UI.
  - Will optionally pass recency metadata into tool calls and tighten synthesis wording for freshness-sensitive prompts.

- `supabase/functions/mcp-server/scrapers/webSearch.ts`
  - Aggregates provider search results.
  - Will add query expansion, freshness extraction/scoring, strict/soft recency filtering, and recency-aware ranking.

- `supabase/functions/mcp-server/ai/chat.ts`
  - Sync factual orchestration path.
  - Will use the new recency-aware search API and add freshness disclosure rules to synthesis prompts.

### New files to create

- `src/lib/recency.ts`
  - Shared frontend recency-profile detection and runtime date-query helper.

- `supabase/functions/mcp-server/search/recency.ts`
  - Edge-function recency-profile detection, runtime date helpers, query expansion, freshness signal extraction, and scoring utilities.

- `src/test/recency.test.ts`
  - Unit tests for recency intent/profile detection.

## Implementation Notes

- Do not hardcode `2026` or any specific year in implementation logic.
- Use `new Date()` and UTC-safe formatting utilities for runtime date hints.
- Preserve current JSON-RPC and SSE contracts; do not change `callToolStream` semantics.
- Prefer additive helpers instead of growing `AIChat.tsx` and `webSearch.ts` inline.
- Keep non-recency queries behaviorally close to current behavior.

---

### Task 1: Add shared frontend recency helpers

**Files:**
- Create: `src/lib/recency.ts`
- Test: `src/test/recency.test.ts`

- [ ] **Step 1: Write the failing tests for recency profile detection**

```ts
import { describe, expect, it } from "vitest";
import { buildRuntimeDateHints, detectRecencyProfile } from "@/lib/recency";

describe("detectRecencyProfile", () => {
  it("detects strict recent intent for latest news queries", () => {
    const profile = detectRecencyProfile("latest technology news");

    expect(profile.mode).toBe("recent");
    expect(profile.strictFreshness).toBe(true);
    expect(profile.preferNewsSources).toBe(true);
    expect(profile.window).toBe("recent");
  });

  it("detects current-window intent for this week queries", () => {
    const profile = detectRecencyProfile("apa update AI minggu ini?");

    expect(profile.mode).toBe("current_window");
    expect(profile.window).toBe("week");
    expect(profile.strictFreshness).toBe(true);
  });

  it("detects future intent for upcoming queries", () => {
    const profile = detectRecencyProfile("fitur AI yang akan datang tahun depan");

    expect(profile.mode).toBe("future");
    expect(profile.preferNewsSources).toBe(true);
  });

  it("does not force recency for evergreen ranking queries", () => {
    const profile = detectRecencyProfile("best AI tools for coding");

    expect(profile.mode).toBe("none");
    expect(profile.strictFreshness).toBe(false);
  });
});

describe("buildRuntimeDateHints", () => {
  it("builds dynamic month and year hints from runtime date", () => {
    const hints = buildRuntimeDateHints(new Date("2026-04-21T10:00:00.000Z"));

    expect(hints.currentYear).toBe("2026");
    expect(hints.currentMonthLabel).toBe("April 2026");
    expect(hints.nextYear).toBe("2027");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- src/test/recency.test.ts`
Expected: FAIL because `src/lib/recency.ts` does not exist yet.

- [ ] **Step 3: Create the frontend recency helper with minimal passing implementation**

```ts
export type RecencyMode = "none" | "recent" | "current_window" | "future";
export type RecencyWindow = "none" | "recent" | "day" | "week" | "month" | "year" | "explicit";

export interface RecencyProfile {
  mode: RecencyMode;
  window: RecencyWindow;
  preferNewsSources: boolean;
  strictFreshness: boolean;
  userSpecifiedYear?: number;
  signals: string[];
}

const RECENT_PATTERNS = [
  /\b(latest|newest|recent|current|up[- ]to[- ]date)\b/i,
  /\b(terbaru|terkini|paling baru)\b/i,
  /\b(news|update|updates|release|launch)\b/i,
];

const WINDOW_PATTERNS: Array<{ window: RecencyWindow; pattern: RegExp }> = [
  { window: "day", pattern: /\b(today|hari ini)\b/i },
  { window: "week", pattern: /\b(this week|minggu ini)\b/i },
  { window: "month", pattern: /\b(this month|bulan ini)\b/i },
  { window: "year", pattern: /\b(this year|tahun ini)\b/i },
];

const FUTURE_PATTERNS = [
  /\b(upcoming|coming soon|next|roadmap|planned)\b/i,
  /\b(akan datang|selanjutnya|rencana)\b/i,
];

export function detectRecencyProfile(text: string): RecencyProfile {
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const explicitYear = yearMatch ? Number(yearMatch[1]) : undefined;
  const signals: string[] = [];

  const future = FUTURE_PATTERNS.some((pattern) => pattern.test(text));
  if (future) signals.push("future");

  const matchedWindow = WINDOW_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (matchedWindow) signals.push(`window:${matchedWindow.window}`);

  const recent = RECENT_PATTERNS.some((pattern) => pattern.test(text));
  if (recent) signals.push("recent");

  if (future) {
    return {
      mode: "future",
      window: explicitYear ? "explicit" : "year",
      preferNewsSources: true,
      strictFreshness: false,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  if (matchedWindow) {
    return {
      mode: "current_window",
      window: matchedWindow.window,
      preferNewsSources: true,
      strictFreshness: true,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  if (recent) {
    return {
      mode: "recent",
      window: explicitYear ? "explicit" : "recent",
      preferNewsSources: true,
      strictFreshness: true,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  return {
    mode: "none",
    window: explicitYear ? "explicit" : "none",
    preferNewsSources: false,
    strictFreshness: false,
    userSpecifiedYear: explicitYear,
    signals,
  };
}

export function buildRuntimeDateHints(now = new Date()) {
  const currentYear = String(now.getUTCFullYear());
  const currentMonthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const nextYear = String(now.getUTCFullYear() + 1);

  return { currentYear, currentMonthLabel, nextYear };
}
```

- [ ] **Step 4: Re-run the tests to confirm they pass**

Run: `npm run test -- src/test/recency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add src/lib/recency.ts src/test/recency.test.ts
git commit -m "feat: add dynamic recency profile helpers"
```

### Task 2: Use recency helpers in frontend intent routing

**Files:**
- Modify: `src/lib/intentClassifier.ts`
- Test: `src/test/recency.test.ts`

- [ ] **Step 1: Extend the failing tests to verify `needsEvidence` stays dynamic**

```ts
import { needsEvidence } from "@/lib/intentClassifier";

it("treats current-window prompts as evidence-seeking without hardcoded years", () => {
  expect(needsEvidence("berita AI terbaru minggu ini")).toBe(true);
  expect(needsEvidence("current GPU prices this month")).toBe(true);
});

it("does not force evidence for short casual chat", () => {
  expect(needsEvidence("hello there")).toBe(false);
});
```

- [ ] **Step 2: Run the tests to confirm the new assertions fail**

Run: `npm run test -- src/test/recency.test.ts`
Expected: FAIL because `needsEvidence` still relies on static keyword matching.

- [ ] **Step 3: Refactor `intentClassifier.ts` to use `detectRecencyProfile`**

```ts
import { detectRecencyProfile } from "@/lib/recency";

const EVIDENCE_KEYWORDS = [
  "top", "best", "ranking", "compare", "comparison", "versus", "vs",
  "news", "update", "announce", "release", "launch",
  "how much", "price", "cost", "salary", "revenue",
  "who is", "what is", "when did", "where is",
  "list of", "examples of", "alternatives to",
  "research", "investigate", "find out", "look up",
  "statistics", "stats", "data on", "numbers",
];

export function needsEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const recency = detectRecencyProfile(text);

  if (recency.mode !== "none") {
    return true;
  }

  return EVIDENCE_KEYWORDS.some((kw) => lower.includes(kw));
}
```

- [ ] **Step 4: Re-run the tests for intent routing behavior**

Run: `npm run test -- src/test/recency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the routing change**

```bash
git add src/lib/intentClassifier.ts src/test/recency.test.ts
git commit -m "refactor: make evidence detection recency-aware"
```

### Task 3: Add edge-function recency scoring utilities

**Files:**
- Create: `supabase/functions/mcp-server/search/recency.ts`

- [ ] **Step 1: Create the edge-function recency utility module**

```ts
export type SearchRecencyMode = "none" | "recent" | "current_window" | "future";
export type SearchRecencyWindow = "none" | "recent" | "day" | "week" | "month" | "year" | "explicit";

export interface SearchRecencyProfile {
  mode: SearchRecencyMode;
  window: SearchRecencyWindow;
  preferNewsSources: boolean;
  strictFreshness: boolean;
  userSpecifiedYear?: number;
}

export interface RuntimeDateHints {
  currentYear: string;
  nextYear: string;
  currentMonthLabel: string;
  currentMonthName: string;
}

export interface FreshnessSignals {
  matchedYear?: number;
  relativeFreshness: number;
  sourceBoost: number;
  futureBoost: number;
}

export function detectSearchRecencyProfile(text: string): SearchRecencyProfile {
  const lower = text.toLowerCase();
  const explicitYear = Number(text.match(/\b(20\d{2})\b/)?.[1] || "") || undefined;

  if (/\b(upcoming|coming soon|next|roadmap|akan datang|selanjutnya|rencana)\b/i.test(lower)) {
    return { mode: "future", window: explicitYear ? "explicit" : "year", preferNewsSources: true, strictFreshness: false, userSpecifiedYear: explicitYear };
  }

  if (/\b(today|hari ini)\b/i.test(lower)) {
    return { mode: "current_window", window: "day", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  if (/\b(this week|minggu ini)\b/i.test(lower)) {
    return { mode: "current_window", window: "week", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  if (/\b(this month|bulan ini)\b/i.test(lower)) {
    return { mode: "current_window", window: "month", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  if (/\b(this year|tahun ini)\b/i.test(lower)) {
    return { mode: "current_window", window: "year", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  if (/\b(latest|newest|recent|current|terbaru|terkini|paling baru)\b/i.test(lower)) {
    return { mode: "recent", window: explicitYear ? "explicit" : "recent", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  return { mode: "none", window: explicitYear ? "explicit" : "none", preferNewsSources: false, strictFreshness: false, userSpecifiedYear: explicitYear };
}

export function getRuntimeDateHints(now = new Date()): RuntimeDateHints {
  return {
    currentYear: String(now.getUTCFullYear()),
    nextYear: String(now.getUTCFullYear() + 1),
    currentMonthLabel: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(now),
    currentMonthName: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(now),
  };
}

export function buildSearchQueryVariants(query: string, profile: SearchRecencyProfile, now = new Date()): string[] {
  const hints = getRuntimeDateHints(now);
  const variants = new Set<string>([query]);

  if (profile.mode === "recent" || profile.mode === "current_window") {
    variants.add(`${query} ${hints.currentMonthLabel}`);
    variants.add(`${query} ${hints.currentYear}`);
    if (profile.preferNewsSources) {
      variants.add(`${query} latest news ${hints.currentYear}`);
    }
  }

  if (profile.mode === "future") {
    variants.add(`${query} upcoming ${hints.currentYear}`);
    variants.add(`${query} roadmap ${hints.currentYear}`);
    variants.add(`${query} ${hints.nextYear}`);
  }

  return [...variants].slice(0, 4);
}

export function extractFreshnessSignals(input: { title: string; snippet: string; searchSource: string }, profile: SearchRecencyProfile, now = new Date()): FreshnessSignals {
  const haystack = `${input.title} ${input.snippet}`;
  const matchedYear = Number(haystack.match(/\b(20\d{2})\b/)?.[1] || "") || undefined;
  const currentYear = now.getUTCFullYear();
  let relativeFreshness = 0;

  if (/\b(hours? ago|today|yesterday)\b/i.test(haystack)) relativeFreshness += 8;
  if (/\b(this week|this month)\b/i.test(haystack)) relativeFreshness += 6;
  if (matchedYear === currentYear) relativeFreshness += 5;
  if (matchedYear === currentYear - 1 && profile.strictFreshness) relativeFreshness -= 4;
  if (matchedYear && matchedYear < currentYear - 1 && profile.strictFreshness) relativeFreshness -= 8;

  const sourceBoost = profile.preferNewsSources && ["bing_rss", "google_news_rss"].includes(input.searchSource) ? 3 : 0;
  const futureBoost = profile.mode === "future" && /\b(upcoming|roadmap|preview|planned|coming soon)\b/i.test(haystack) ? 4 : 0;

  return { matchedYear, relativeFreshness, sourceBoost, futureBoost };
}

export function scoreFreshness(input: { title: string; snippet: string; searchSource: string }, profile: SearchRecencyProfile, now = new Date()): number {
  const signals = extractFreshnessSignals(input, profile, now);
  return signals.relativeFreshness + signals.sourceBoost + signals.futureBoost;
}
```

- [ ] **Step 2: Commit the edge-function recency module**

```bash
git add supabase/functions/mcp-server/search/recency.ts
git commit -m "feat: add edge search recency scoring utilities"
```

### Task 4: Make `searchWeb` query expansion and ranking recency-aware

**Files:**
- Modify: `supabase/functions/mcp-server/scrapers/webSearch.ts`
- Create or update imports from: `supabase/functions/mcp-server/search/recency.ts`

- [ ] **Step 1: Update the `SearchResult` shape to carry ranking metadata**

```ts
export interface SearchResult {
  title: string;
  url: string;
  sourceUrl: string;
  snippet: string;
  rawDesc: string;
  acquisitionType: AcquisitionType;
  searchSource: string;
  freshnessScore?: number;
  matchedYear?: number;
}
```

- [ ] **Step 2: Import recency helpers and build query variants inside `searchWeb`**

```ts
import {
  buildSearchQueryVariants,
  detectSearchRecencyProfile,
  extractFreshnessSignals,
  scoreFreshness,
} from "../search/recency.ts";

export async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  console.log("[search] Starting multi-source search for:", query, "max:", maxResults);

  const profile = detectSearchRecencyProfile(query);
  const variants = buildSearchQueryVariants(query, profile);

  const allResults: SearchResult[] = [];

  for (const variant of variants) {
    const [ddgResults, bingResults, gnewsResults] = await Promise.all([
      searchDuckDuckGo(variant, maxResults),
      searchBingNewsRss(variant, maxResults),
      searchGoogleNewsRss(variant, maxResults),
    ]);

    for (const result of ddgResults) allResults.push(result);
    for (const result of bingResults) allResults.push(result);
    for (const result of gnewsResults.filter((result) => result.acquisitionType === "resolved_article")) allResults.push(result);
    for (const result of gnewsResults.filter((result) => result.acquisitionType === "direct_article")) allResults.push(result);
    for (const result of gnewsResults.filter((result) => result.acquisitionType === "unresolved_wrapper")) allResults.push(result);
  }
```

- [ ] **Step 3: Replace first-N slicing with scored dedupe and strict/soft filtering**

```ts
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of allResults) {
    const key = result.url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    const signals = extractFreshnessSignals(result, profile);
    deduped.push({
      ...result,
      freshnessScore: scoreFreshness(result, profile),
      matchedYear: signals.matchedYear,
    });
  }

  const sorted = deduped.sort((a, b) => (b.freshnessScore || 0) - (a.freshnessScore || 0));

  const strictFiltered = profile.strictFreshness
    ? sorted.filter((result) => (result.freshnessScore || 0) >= 0)
    : sorted;

  const finalPool = strictFiltered.length >= Math.min(maxResults, 3) ? strictFiltered : sorted;
  const final = finalPool.slice(0, maxResults);

  console.log("[search] Combined results:", final.length,
    "| profile:", profile.mode,
    "| strict:", profile.strictFreshness,
    "| variants:", variants.length);

  return final;
}
```

- [ ] **Step 4: Sanity-check the edge function file for type errors**

Run: check workspace diagnostics for `supabase/functions/mcp-server/scrapers/webSearch.ts` and `supabase/functions/mcp-server/search/recency.ts`
Expected: no new TypeScript errors in either file.

- [ ] **Step 5: Commit the recency-aware search ranking changes**

```bash
git add supabase/functions/mcp-server/scrapers/webSearch.ts supabase/functions/mcp-server/search/recency.ts
git commit -m "feat: rank search results by dynamic recency"
```

### Task 5: Tighten sync factual chat synthesis to disclose freshness limits

**Files:**
- Modify: `supabase/functions/mcp-server/ai/chat.ts`

- [ ] **Step 1: Import recency detection into factual orchestration**

```ts
import { detectSearchRecencyProfile } from "../search/recency.ts";
```

- [ ] **Step 2: Update the factual synthesis branch to include freshness metadata and stricter rules**

```ts
    addStep("Intent: factual — lightweight sync search + synthesis");

    const recencyProfile = detectSearchRecencyProfile(message);
    const searchResults = await searchWeb(message, 5);
    const freshnessSummary = searchResults
      .map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        matchedYear: result.matchedYear,
        freshnessScore: result.freshnessScore,
      }));

    const searchEvidence = JSON.stringify(freshnessSummary, null, 2);
    addStep(`Search returned ${searchResults.length} results`);

    // existing scrape-top-result logic stays in place here

    const synthesisRules = [
      "You are a research assistant that answers ONLY from the provided evidence.",
      "RULES:",
      "1. Base your answer ONLY on the evidence below. Do NOT use background knowledge.",
      "2. If evidence is insufficient, say so. Do not invent.",
      "3. Cite sources by title or URL.",
      "4. Be concise — this is a quick factual answer, not a research report.",
      "5. Include relevant source URLs at the end.",
      recencyProfile.mode !== "none"
        ? "6. This is a recency-sensitive query. Make the freshness of the evidence explicit and do not present older coverage as current if newer coverage is missing."
        : "6. If the evidence looks stale, say so explicitly.",
      recencyProfile.mode === "future"
        ? "7. Distinguish between confirmed upcoming items and speculative predictions."
        : "7. If most evidence is older than the current period implied by the question, say that clearly.",
    ];
```

- [ ] **Step 3: Verify diagnostics for `ai/chat.ts`**

Run: check workspace diagnostics for `supabase/functions/mcp-server/ai/chat.ts`
Expected: no new errors.

- [ ] **Step 4: Commit the synthesis guardrail update**

```bash
git add supabase/functions/mcp-server/ai/chat.ts
git commit -m "feat: disclose freshness limits in sync factual synthesis"
```

### Task 6: Optionally pass recency profile from the frontend synthesis path

**Files:**
- Modify: `src/pages/AIChat.tsx`
- Modify: `src/lib/recency.ts`

- [ ] **Step 1: Import `detectRecencyProfile` into the AI chat page**

```tsx
import { detectRecencyProfile } from "@/lib/recency";
```

- [ ] **Step 2: Add recency metadata to the synthesis chat call without changing streaming behavior**

```tsx
const recencyProfile = detectRecencyProfile(text);

for await (const delta of callToolStream("chat", {
  message: `User question: ${text}\n\n${combinedEvidence.slice(0, 14000)}`,
  history: [{ role: "system", content: synthesisPrompt }],
  mode: "synthesis",
  recencyProfile,
}, controller.signal)) {
  if (controller.signal.aborted) return;
  synthText += delta;
  setStreamingContent(synthText);
}
```

- [ ] **Step 3: Adjust the frontend synthesis prompt to ask for freshness disclosure when relevant**

```tsx
const recencyProfile = detectRecencyProfile(text);

const baseRules = [
  "You are a research assistant. Answer the user's question based ONLY on the evidence provided below.",
  "CRITICAL RULES:",
  "1. Use ONLY the evidence below. Do NOT fill gaps with your own knowledge or training data.",
  "2. If the evidence is insufficient or does not address the question, explicitly state what was found and what is missing.",
  "3. Cite sources by title or URL when making claims.",
  "4. Be structured, clear, and concise.",
  "5. If evidence contains conflicting information, note the discrepancy.",
  `6. Evidence was gathered using: ${toolsUsed.join(", ")}`,
  allSourceUrls.length > 0 ? `7. Available source URLs: ${allSourceUrls.slice(0, 10).join(", ")}` : "",
  recencyProfile.mode !== "none" ? "8. This is a freshness-sensitive query. If the evidence is older than the requested time frame, say so clearly instead of implying it is current." : "",
].filter(Boolean);
```

- [ ] **Step 4: Verify frontend diagnostics**

Run: check workspace diagnostics for `src/pages/AIChat.tsx` and `src/lib/recency.ts`
Expected: no new TypeScript errors.

- [ ] **Step 5: Commit the frontend synthesis metadata update**

```bash
git add src/pages/AIChat.tsx src/lib/recency.ts
git commit -m "feat: carry recency intent into frontend synthesis"
```

### Task 7: Final verification

**Files:**
- Verify: `src/lib/recency.ts`
- Verify: `src/lib/intentClassifier.ts`
- Verify: `src/pages/AIChat.tsx`
- Verify: `supabase/functions/mcp-server/search/recency.ts`
- Verify: `supabase/functions/mcp-server/scrapers/webSearch.ts`
- Verify: `supabase/functions/mcp-server/ai/chat.ts`
- Verify: `src/test/recency.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `npm run test -- src/test/recency.test.ts`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS with no new issues in touched files.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification in chat UI**

Check these prompts manually:

```text
berikan 10 berita teknologi terbaru
apa update AI minggu ini?
current GPU prices
fitur AI yang akan datang tahun depan
```

Expected:
- newer/current-year sources rank above older evergreen content for freshness-sensitive prompts
- future-looking prompts prefer roadmap/announcement style results
- if only older sources are found, the answer says so explicitly
- streaming behavior remains unchanged from current design

- [ ] **Step 5: Commit the final verified state**

```bash
git add src/lib/recency.ts src/lib/intentClassifier.ts src/pages/AIChat.tsx src/test/recency.test.ts supabase/functions/mcp-server/search/recency.ts supabase/functions/mcp-server/scrapers/webSearch.ts supabase/functions/mcp-server/ai/chat.ts
git commit -m "feat: make recency-sensitive search dynamically freshness-aware"
```

---

## Self-Review Checklist

- Spec coverage:
  - dynamic recency detection -> Tasks 1-2
  - runtime date context -> Tasks 1 and 3
  - query expansion -> Task 4
  - freshness scoring -> Task 4
  - synthesis guardrails -> Tasks 5-6
  - backward compatibility and verification -> Task 7
- Placeholder scan: no `TODO`, `TBD`, or undefined code steps included.
- Type consistency: `RecencyProfile` / `SearchRecencyProfile` names remain stable across tasks, and `freshnessScore`/`matchedYear` are used consistently.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-dynamic-recency-search.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
