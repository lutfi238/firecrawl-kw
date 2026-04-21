import { htmlToMarkdown } from "./htmlToMarkdown.ts";
import { decodeEscapedUrl, decodeGoogleNewsToken, isGoogleNewsRssWrapper, isValidArticleUrl, normalizeResolvedUrl } from "./googleNews.ts";
import { buildSearchQueryVariants, detectSearchRecencyProfile, extractFreshnessSignals, type SearchRecencyProfile } from "../search/recency.ts";

export type AcquisitionType = "direct_article" | "resolved_article" | "unresolved_wrapper" | "failed_fetch";

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

export async function scrapeUrl(url: string): Promise<{ markdown: string; title: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  return { markdown: htmlToMarkdown(html), title };
}

async function resolveGoogleNewsRssUrl(url: string, rawDesc?: string): Promise<{ finalUrl?: string; resolveStatus: "resolved" | "unresolved_wrapper" | "failed"; error?: string; method?: string }> {
  try {
    if (rawDesc) {
      console.log("[gnews-resolve] rawDesc present, length:", rawDesc.length);
      const decoded = rawDesc
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const hrefMatches = [...decoded.matchAll(/href="(https?:\/\/[^"]+)"/gi)];
      for (const hm of hrefMatches) {
        const candidate = normalizeResolvedUrl(hm[1]);
        if (candidate) {
          console.log("[gnews-resolve] Found publisher URL from description href:", candidate);
          return { finalUrl: candidate, resolveStatus: "resolved", method: "desc_href" };
        }
      }
      const bareUrls = [...decoded.matchAll(/(https?:\/\/[^\s"'<>]+)/gi)];
      for (const bu of bareUrls) {
        const candidate = normalizeResolvedUrl(bu[1]);
        if (candidate) {
          console.log("[gnews-resolve] Found publisher URL from description text:", candidate);
          return { finalUrl: candidate, resolveStatus: "resolved", method: "desc_text" };
        }
      }
      console.log("[gnews-resolve] No publisher URL found in description");
    } else {
      console.log("[gnews-resolve] rawDesc is MISSING — cannot extract from description");
    }

    const parsed = new URL(url);
    const token = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const decodedCandidate = decodeGoogleNewsToken(token);
    if (decodedCandidate) {
      console.log("[gnews-resolve] Decoded publisher URL from token:", decodedCandidate);
      return { finalUrl: decodedCandidate, resolveStatus: "resolved", method: "token_decode" };
    }
    console.log("[gnews-resolve] Token decode failed for:", token.slice(0, 30) + "...");

    console.log("[gnews-resolve] Trying HTTP fetch fallback");
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (res.url && normalizeResolvedUrl(res.url)) {
      console.log("[gnews-resolve] HTTP redirect resolved to:", res.url);
      return { finalUrl: res.url, resolveStatus: "resolved", method: "http_redirect" };
    }

    const html = await res.text();
    console.log("[gnews-resolve] Fetched page length:", html.length);
    const patterns = [
      /"canonicalUrl":"(https?:\/\/[^"\\]+)"/gi,
      /"url":"(https?:\/\/[^"\\]+)"/gi,
      /data-url="(https?:\/\/[^"]+)"/gi,
      /href="(https?:\/\/[^"]+)"/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html)) !== null) {
        const candidate = decodeEscapedUrl(match[1] || match[0]);
        const normalized = normalizeResolvedUrl(candidate);
        if (normalized) {
          console.log("[gnews-resolve] Found URL from page HTML:", normalized);
          return { finalUrl: normalized, resolveStatus: "resolved", method: "html_extract" };
        }
      }
    }

    console.log("[gnews-resolve] All strategies failed for:", url.slice(0, 80));
    return { resolveStatus: "unresolved_wrapper", error: "Could not extract publisher URL from Google News RSS wrapper" };
  } catch (error) {
    console.log("[gnews-resolve] Error:", error instanceof Error ? error.message : "unknown");
    return { resolveStatus: "failed", error: error instanceof Error ? error.message : "google news resolve failed" };
  }
}

export function isUsableArticleContent(markdown: string): boolean {
  if (markdown.length < 300) return false;

  const paragraphs = markdown.split(/\n\n+/).filter((paragraph) => paragraph.trim().length > 50);
  if (paragraphs.length < 2) return false;

  const totalTextLength = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const avgParagraphLength = totalTextLength / paragraphs.length;
  if (avgParagraphLength < 40) return false;

  const lower = markdown.toLowerCase();
  const boilerplateSignals = [
    "sign in", "log in", "subscribe now", "cookie policy",
    "accept cookies", "privacy policy", "terms of service",
  ];
  const boilerplateHits = boilerplateSignals.filter((signal) => lower.includes(signal)).length;
  if (boilerplateHits >= 3 && markdown.length < 1000) return false;

  return true;
}

type RankedSearchResult = SearchResult & {
  freshnessScore: number;
  matchedYear?: number;
  sourcePriority: number;
  order: number;
};

function getSearchResultKey(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0];
}

function getSearchResultPriority(result: SearchResult): number {
  if (result.searchSource === "duckduckgo") return 0;
  if (result.searchSource === "bing_rss") return 1;
  if (result.searchSource === "google_news_rss") {
    if (result.acquisitionType === "resolved_article") return 2;
    if (result.acquisitionType === "direct_article") return 3;
    return 4;
  }
  return 5;
}

function buildRankedSearchResult(result: SearchResult, profile: SearchRecencyProfile, order: number): RankedSearchResult {
  const signals = extractFreshnessSignals(result, profile);
  const freshnessScore = profile.mode === "none"
    ? 0
    : signals.relativeFreshness + signals.sourceBoost + signals.futureBoost;

  return {
    ...result,
    freshnessScore: freshnessScore === 0 && profile.strictFreshness ? -1 : freshnessScore,
    matchedYear: signals.matchedYear,
    sourcePriority: getSearchResultPriority(result),
    order,
  };
}

function compareRankedSearchResults(a: RankedSearchResult, b: RankedSearchResult): number {
  const freshnessDiff = (b.freshnessScore ?? 0) - (a.freshnessScore ?? 0);
  if (freshnessDiff !== 0) return freshnessDiff;

  const priorityDiff = a.sourcePriority - b.sourcePriority;
  if (priorityDiff !== 0) return priorityDiff;

  return a.order - b.order;
}

function mergeRankedSearchResults(existing: RankedSearchResult, candidate: RankedSearchResult): RankedSearchResult {
  if (candidate.freshnessScore > existing.freshnessScore) {
    return { ...candidate, matchedYear: candidate.matchedYear ?? existing.matchedYear, order: existing.order };
  }

  if (candidate.freshnessScore < existing.freshnessScore) {
    return { ...existing, matchedYear: existing.matchedYear ?? candidate.matchedYear };
  }

  if (candidate.sourcePriority < existing.sourcePriority) {
    return { ...candidate, matchedYear: candidate.matchedYear ?? existing.matchedYear, order: existing.order };
  }

  return { ...existing, matchedYear: existing.matchedYear ?? candidate.matchedYear };
}

async function searchAllProviders(query: string, maxResults: number): Promise<SearchResult[]> {
  const [ddgResults, bingResults, gnewsResults] = await Promise.all([
    searchDuckDuckGo(query, maxResults),
    searchBingNewsRss(query, maxResults),
    searchGoogleNewsRss(query, maxResults),
  ]);

  const allResults: SearchResult[] = [];
  for (const result of ddgResults) allResults.push(result);
  for (const result of bingResults) allResults.push(result);
  for (const result of gnewsResults.filter((result) => result.acquisitionType === "resolved_article")) allResults.push(result);
  for (const result of gnewsResults.filter((result) => result.acquisitionType === "direct_article")) allResults.push(result);
  for (const result of gnewsResults.filter((result) => result.acquisitionType === "unresolved_wrapper")) allResults.push(result);

  return allResults;
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    console.log("[search-ddg] Fetching:", ddgUrl);
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log("[search-ddg] HTTP", res.status);
      return [];
    }
    const html = await res.text();
    console.log("[search-ddg] Response length:", html.length);

    const results: SearchResult[] = [];
    const resultBlocks = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetBlocks = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];

    for (let i = 0; i < resultBlocks.length && results.length < maxResults; i++) {
      let rawHref = resultBlocks[i][1];
      const rawTitle = resultBlocks[i][2].replace(/<[^>]+>/g, "").trim();

      if (rawHref.includes("uddg=")) {
        const match = rawHref.match(/uddg=([^&]+)/);
        if (match) rawHref = decodeURIComponent(match[1]);
      }

      const check = isValidArticleUrl(rawHref);
      if (!check.valid) {
        console.log("[search-ddg] Skipping non-article:", rawHref.slice(0, 80), check.reason);
        continue;
      }

      const snippet = snippetBlocks[i]
        ? snippetBlocks[i][1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
        : "";

      results.push({
        title: rawTitle,
        url: rawHref,
        sourceUrl: rawHref,
        snippet: snippet.slice(0, 200),
        rawDesc: "",
        acquisitionType: "direct_article",
        searchSource: "duckduckgo",
      });
    }

    console.log("[search-ddg] Found", results.length, "direct publisher results");
    return results;
  } catch (error) {
    console.log("[search-ddg] Error:", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

async function searchGoogleNewsRss(query: string, maxResults: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const feedUrl = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;
  try {
    console.log("[search-gnews] Fetching:", feedUrl);
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log("[search-gnews] HTTP", res.status);
      return [];
    }
    const xml = await res.text();

    const rawItems: Array<{ title: string; rawLink: string; rawDesc: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && rawItems.length < maxResults) {
      const item = match[1];
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const linkMatch = item.match(/<link\s*\/?>\s*<!\[CDATA\[(.*?)\]\]>|<link>(.*?)<\/link>|<link\s*\/?>([^<\s]+)/i);
      const guidMatch = item.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
      const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
      const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (linkMatch?.[1] || linkMatch?.[2] || linkMatch?.[3] || guidMatch?.[1] || "").trim();
      if (title && rawLink) {
        rawItems.push({ title, rawLink, rawDesc: descMatch?.[1] || descMatch?.[2] || "" });
      }
    }

    const results: SearchResult[] = [];
    for (const { title, rawLink, rawDesc } of rawItems) {
      if (isGoogleNewsRssWrapper(rawLink)) {
        const resolved = await resolveGoogleNewsRssUrl(rawLink, rawDesc);
        if (resolved.finalUrl && resolved.resolveStatus === "resolved") {
          results.push({
            title,
            url: resolved.finalUrl,
            sourceUrl: rawLink,
            snippet: "",
            rawDesc,
            acquisitionType: "resolved_article",
            searchSource: "google_news_rss",
          });
        } else {
          results.push({
            title,
            url: rawLink,
            sourceUrl: rawLink,
            snippet: "",
            rawDesc,
            acquisitionType: "unresolved_wrapper",
            searchSource: "google_news_rss",
          });
        }
      } else {
        results.push({
          title,
          url: rawLink,
          sourceUrl: rawLink,
          snippet: "",
          rawDesc,
          acquisitionType: "direct_article",
          searchSource: "google_news_rss",
        });
      }
    }

    for (const result of results) {
      if (result.rawDesc && !result.snippet) {
        const cleaned = result.rawDesc
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
          .replace(/<[^>]+>/g, "").trim();
        if (cleaned.length > 30) result.snippet = cleaned.slice(0, 200);
      }
    }

    console.log("[search-gnews] Found", results.length, "results (",
      results.filter((result) => result.acquisitionType === "direct_article").length, "direct,",
      results.filter((result) => result.acquisitionType === "resolved_article").length, "resolved,",
      results.filter((result) => result.acquisitionType === "unresolved_wrapper").length, "unresolved)");
    return results;
  } catch (error) {
    console.log("[search-gnews] Error:", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

async function searchBingNewsRss(query: string, maxResults: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const feedUrl = `https://www.bing.com/news/search?q=${encoded}&format=rss`;
  try {
    console.log("[search-bing] Fetching:", feedUrl);
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log("[search-bing] HTTP", res.status);
      return [];
    }
    const xml = await res.text();
    const results: SearchResult[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const item = match[1];
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const linkMatch = item.match(/<link>(.*?)<\/link>/i);
      const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (linkMatch?.[1] || "").trim();
      if (title && rawLink && isValidArticleUrl(rawLink).valid) {
        results.push({
          title,
          url: rawLink,
          sourceUrl: rawLink,
          snippet: "",
          rawDesc: "",
          acquisitionType: "direct_article",
          searchSource: "bing_rss",
        });
      }
    }
    console.log("[search-bing] Found", results.length, "direct results");
    return results;
  } catch (error) {
    console.log("[search-bing] Error:", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

export async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  console.log("[search] Starting multi-source search for:", query, "max:", maxResults);

  const profile = detectSearchRecencyProfile(query);
  const variants = buildSearchQueryVariants(query, profile);
  const searchVariants = variants.length > 0 ? variants : [query];

  const allResults: SearchResult[] = [];
  for (const variant of searchVariants) {
    const variantResults = await searchAllProviders(variant, maxResults);
    for (const result of variantResults) allResults.push(result);
  }

  const dedupedByKey = new Map<string, RankedSearchResult>();
  let order = 0;
  for (const result of allResults) {
    const ranked = buildRankedSearchResult(result, profile, order++);
    const key = getSearchResultKey(ranked.url);
    const existing = dedupedByKey.get(key);
    if (!existing) {
      dedupedByKey.set(key, ranked);
      continue;
    }

    dedupedByKey.set(key, mergeRankedSearchResults(existing, ranked));
  }

  const sorted = [...dedupedByKey.values()].sort(compareRankedSearchResults);
  const filtered = profile.strictFreshness
    ? sorted.filter((result) => (result.freshnessScore ?? 0) >= 0)
    : sorted;

  const finalResults = profile.strictFreshness && filtered.length < maxResults ? sorted : filtered;
  const final = finalResults.slice(0, maxResults).map(({ sourcePriority, order: _order, ...result }) => result);
  console.log("[search] Combined results:", final.length,
    "| direct:", final.filter((result) => result.acquisitionType === "direct_article").length,
    "| resolved:", final.filter((result) => result.acquisitionType === "resolved_article").length,
    "| unresolved:", final.filter((result) => result.acquisitionType === "unresolved_wrapper").length);
  return final;
}
