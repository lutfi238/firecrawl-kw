# Dynamic Recency-Aware Search Design

Date: 2026-04-21
Topic: Always-up-to-date search and synthesis without hardcoded years

## Goal

Make AI chat prefer the newest available information for recency-sensitive queries such as `latest`, `recent`, `current`, `today`, `this week`, `this month`, `this year`, `terbaru`, `hari ini`, `minggu ini`, `bulan ini`, `tahun ini`, and future-looking requests like `upcoming`, `next`, `akan datang`, or `roadmap`.

The system must stay current automatically as time moves forward, without hardcoding specific years like `2026`.

## Current Behavior

Today, recency-sensitive prompts are routed into the normal evidence-first search flow:

- `src/lib/intentClassifier.ts` marks many freshness queries as evidence-seeking, but only because of static keywords.
- `src/pages/AIChat.tsx` runs `search` first, then optional `search_and_scrape`, then synthesis.
- `supabase/functions/mcp-server/scrapers/webSearch.ts` aggregates DuckDuckGo, Bing News RSS, and Google News RSS results, dedupes them, then returns the first N results.
- There is no dynamic recency scoring, time-window filtering, or runtime date expansion.
- Synthesis answers from the collected evidence, even if the evidence is stale.

This means a prompt like `latest technology news` can still surface 2025 results in 2026 if search providers rank them highly.

## Desired Outcome

For recency-sensitive prompts:

1. Search queries should be dynamically enriched with runtime date context.
2. News-oriented sources should be favored more strongly.
3. Results should be re-ranked by freshness signals rather than raw source order alone.
4. Stale evidence should be filtered or clearly deprioritized.
5. Final synthesis should explicitly acknowledge freshness limits when truly recent evidence is weak.

## Non-Goals

- Building a full historical index.
- Adding third-party paid news APIs.
- Guaranteeing perfect freshness for every topic on the web.
- Rewriting the entire orchestration model.

## Approach Options

### Option A — Query Expansion Only
Add runtime date tokens like current month/year to the outgoing query.

Pros:
- Minimal change.
- Low risk.

Cons:
- Still depends heavily on external provider ranking.
- Does not solve stale result ordering after aggregation.

### Option B — Query Expansion + Recency Scoring + Synthesis Guardrails
Add runtime time-awareness in the query, then re-rank aggregated results using freshness heuristics, and teach synthesis to report freshness limits honestly.

Pros:
- Strong improvement without major architecture changes.
- Works with existing providers and current tool flow.
- Avoids hardcoded years.

Cons:
- Heuristics may not always infer exact publication dates.

### Option C — Recency Mode with Separate News-First Pipeline
Create a dedicated news/freshness pipeline for time-sensitive prompts, potentially bypassing generic search behavior.

Pros:
- Highest long-term control.

Cons:
- More invasive.
- Higher maintenance and contract risk.

## Recommendation

Use **Option B**.

It gives the best balance of freshness, safety, and implementation size. It fits the current frontend + edge function architecture and preserves existing JSON-RPC and SSE behavior.

## Design

### 1. Dynamic Recency Intent Detection

Add a shared concept of **recency intent** that detects whether a prompt is asking for:

- latest/current information
- recent news or releases
- near-term future items
- this week / this month / this year windows

This detection must not rely on static years. It should instead use:

- natural-language freshness keywords
- relative time phrases
- future-looking phrases
- optional explicit years if the user provides one

Outputs should include a structured recency profile, for example:

- `mode`: `none | recent | current_window | future`
- `window`: `day | week | month | year | explicit`
- `userSpecifiedYear?`
- `preferNewsSources: boolean`
- `strictFreshness: boolean`

This profile will be used by both frontend routing and backend search orchestration where helpful.

### 2. Runtime Date Context Builder

Add a small runtime helper that computes date-aware query hints using the current date at execution time.

Examples for April 21, 2026:

- `latest technology news` → search hint includes `April 2026`, `2026`, `this month`
- `AI updates this week` → search hint includes `April 2026`, `this week`
- `upcoming AI launches` → search hint includes `2026`, `upcoming`, `next`, `roadmap`

This builder should:

- avoid hardcoded years
- use `new Date()` at runtime
- produce a small set of expansion variants instead of a single bloated query
- avoid overfitting to one provider syntax

### 3. Recency-Aware Search Query Strategy

In `webSearch.ts`, when recency intent is present:

- prefer news-oriented query variants first
- search providers using dynamically enriched queries
- preserve provider diversity, but bias toward feeds/sources that usually expose fresher items

Expected strategy:

- generic source query
- news-leaning variant
- current month/year variant
- future-oriented variant when applicable

The system should still dedupe across variants.

### 4. Freshness Heuristic Scoring

Add a post-aggregation scoring step before the final slice to `maxResults`.

Signals may include:

- year/month/day mentions in title or snippet
- relative-time phrases in snippets such as `hours ago`, `today`, `yesterday`
- source type preference when recency intent is active
- news-provider priority for `latest/current` prompts
- future-facing keywords for `upcoming` prompts
- stale-year penalties when the query explicitly asks for current or latest info

The scoring system should be heuristic and explainable, not opaque.

Example ranking behavior:

- 2026 article about a current release outranks a strong 2025 evergreen explainer.
- `upcoming models 2026` should favor roadmap / launch-preview pages over retrospective articles.

### 5. Soft and Strict Freshness Modes

Use two operating modes:

- **Soft freshness**: prefer newer results, but still allow older authoritative results if current ones are weak.
- **Strict freshness**: for strongly time-sensitive prompts (`today`, `latest news`, `this week`, `current price`), filter or heavily penalize stale results.

This avoids over-filtering normal factual queries while being aggressive for freshness-critical ones.

### 6. Synthesis Guardrails

Update synthesis prompts so the answer reflects evidence freshness honestly.

Required behaviors:

- mention when evidence appears current to a particular month/year or relative window
- explicitly say when only older evidence was found
- avoid wording that implies present-day certainty if evidence is stale
- for future-oriented prompts, distinguish between confirmed announcements and speculation

Example output behavior:

- `Based on the sources found from April 2026...`
- `I found mostly 2025 coverage; I could not verify newer reporting in the retrieved sources.`

### 7. Frontend Routing Compatibility

Keep the current tools-first orchestration model intact.

Changes should preserve:

- existing intent classification shape
- current `search` → optional `search_and_scrape` → synthesis flow
- current streaming behavior for final synthesis
- existing UI activity steps

Frontend logic may optionally pass extra recency metadata in tool args, but this is not required if the backend can infer freshness from query text consistently.

### 8. Backward Compatibility

Preserve current behavior for:

- casual chat
- URL scraping
- batch jobs
- crawl jobs
- extract requests
- non-recency factual questions

If no recency signals are detected, `searchWeb(...)` should behave substantially like it does now.

## Affected Files

### Primary

- `src/lib/intentClassifier.ts`
  - add dynamic recency detection helpers
  - reduce dependence on hardcoded year keywords

- `src/pages/AIChat.tsx`
  - optionally pass recency-aware arguments or preserve current behavior if backend-only inference is enough
  - adjust synthesis wording if needed

- `supabase/functions/mcp-server/scrapers/webSearch.ts`
  - add runtime query expansion
  - add freshness scoring / filtering
  - keep provider aggregation and dedupe compatible

- `supabase/functions/mcp-server/ai/chat.ts`
  - update sync factual orchestration to use recency-aware search and synthesis guardrails

### Secondary / Optional

- `supabase/functions/mcp-server/tools/definitions.ts`
  - only if search tool schema must expose optional recency flags

- `src/types/tools.ts`
  - only if frontend tool forms should expose recency controls later

## Error Handling

- If no fresh results are found, return best available evidence rather than empty failure.
- If freshness inference is weak, do not invent publication dates.
- If providers fail, retain existing graceful fallback behavior.
- If date extraction is ambiguous, prefer conservative ranking over hard filtering.

## Testing Strategy

### Unit / Logic-Level

Validate recency profile detection with prompts like:

- `latest AI news`
- `berita AI terbaru hari ini`
- `current OpenAI pricing`
- `upcoming AI models`
- `best AI tools` (should not force strict recency unless phrased as current/latest)

Validate scoring expectations:

- newer 2026 result outranks 2025 evergreen result for `latest` query
- roadmap article outranks retrospective article for `upcoming` query

### Integration / Manual

Manual chat scenarios:

- `berikan 10 berita teknologi terbaru`
- `apa update AI minggu ini?`
- `current GPU prices`
- `fitur AI yang akan datang tahun depan`

Expected outcome:

- fresher sources appear in evidence
- older sources are explicitly labeled as fallback if used
- final answer no longer presents stale results as if they are current

## Risks

- Over-aggressive filtering may reduce result count too much.
- Date heuristics may misread snippets without explicit publication metadata.
- Query expansion may overconstrain some providers if too verbose.

## Mitigations

- use soft vs strict modes
- keep fallback path when strict filtering yields too few results
- limit query expansion variants
- log scoring rationale during development for debugging

## Rollout Notes

Implementation should be incremental:

1. add recency profile detection
2. add dynamic query expansion
3. add freshness scoring
4. update synthesis guardrails
5. manually verify with real prompts

This sequencing reduces regression risk and makes debugging easier.

## Success Criteria

The feature is successful when:

1. Queries asking for latest/current/recent information no longer depend on hardcoded years.
2. The same code continues to work correctly in later years without edits.
3. Search results prefer newer evidence when freshness matters.
4. Answers transparently report when only older evidence is available.
5. Existing non-recency behavior remains stable.
