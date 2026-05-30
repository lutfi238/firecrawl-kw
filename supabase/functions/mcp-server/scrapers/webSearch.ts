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

// ─── Enhanced anti-detection: UA rotation + random delay ─────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(minMs: number = 800, maxMs: number = 2500): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}

function buildBrowserHeaders(): Record<string, string> {
  const ua = getRandomUA();
  // Derive Accept-Language from UA pattern for consistency
  const isMobile = /iPhone|Android|Mobile/i.test(ua);
  return {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": isMobile ? "en-US,en;q=0.9" : "en-US,en;q=0.9,id;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": `"Chromium";v="131", "Not_A Brand";v="24"`,
    "Sec-Ch-Ua-Mobile": isMobile ? "?1" : "?0",
    "Sec-Ch-Ua-Platform": /Macintosh|iPhone|iPad/i.test(ua) ? `"macOS"` : /Android/i.test(ua) ? `"Android"` : `"Windows"`,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };
}

// ─── Free reader proxy definitions ────────────────────────────────────────────

interface ReaderProxy {
  name: string;
  buildUrl: (url: string) => string;
  headers?: Record<string, string>;
  parseResponse?: (text: string) => { markdown: string; title: string };
  timeoutMs?: number;
}

/** Parse Jina Reader response: "Title: ...\nURL Source: ...\nMarkdown Content:\n..." */
function parseJinaResponse(text: string): { markdown: string; title: string } {
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const contentSplit = text.split(/Markdown Content:\s*\n/);
  const markdown = contentSplit.length > 1 ? contentSplit[1].trim() : text;
  return { markdown, title };
}

/** Parse Google Cache response — returns HTML, we convert to markdown */
function parseGoogleCacheResponse(html: string, url: string): { markdown: string; title: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/^Cache of\s*/i, "") : url;
  // Google Cache wraps content in a specific div
  const contentMatch = html.match(/<div[^>]*class=["']maia-body["'][^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const contentHtml = contentMatch ? contentMatch[1] : html;
  return { markdown: htmlToMarkdown(contentHtml), title };
}

/** Parse Wayback Machine response — returns original HTML */
function parseWaybackResponse(html: string, url: string): { markdown: string; title: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  // Wayback adds toolbar at top, try to strip it
  const cleanHtml = html.replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/gi, "");
  return { markdown: htmlToMarkdown(cleanHtml), title };
}

const FREE_READERS: ReaderProxy[] = [
  {
    name: "jina",
    buildUrl: (url: string) => `https://r.jina.ai/${url}`,
    headers: {
      "Accept": "text/plain",
      "X-Return-Format": "markdown",
      "X-No-Cache": "true",
    },
    parseResponse: parseJinaResponse,
    timeoutMs: 30000,
  },
  {
    name: "google-cache",
    buildUrl: (url: string) => `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`,
    headers: {},
    parseResponse: (html: string, _url: string) => parseGoogleCacheResponse(html, _url),
    timeoutMs: 15000,
  },
  {
    name: "wayback",
    buildUrl: (url: string) => `https://web.archive.org/web/2024id_/${url}`,
    headers: {},
    parseResponse: (html: string, _url: string) => parseWaybackResponse(html, _url),
    timeoutMs: 20000,
  },
];

/** Try a single reader proxy, return result or null on failure */
async function tryReaderProxy(
  reader: ReaderProxy,
  url: string,
): Promise<{ markdown: string; title: string } | null> {
  const proxyUrl = reader.buildUrl(url);
  const headers = reader.headers ? { ...reader.headers, "User-Agent": getRandomUA() } : { "User-Agent": getRandomUA() };
  const timeout = reader.timeoutMs || 15000;

  console.log(`[reader] Trying ${reader.name} for ${url.slice(0, 80)}`);

  try {
    const res = await fetch(proxyUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      console.log(`[reader] ${reader.name} returned HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (!text || text.length < 50) {
      console.log(`[reader] ${reader.name} returned empty/short response`);
      return null;
    }

    const parsed = reader.parseResponse
      ? reader.parseResponse(text, url)
      : { markdown: htmlToMarkdown(text), title: url };

    if (!parsed.markdown || parsed.markdown.length < 100) {
      console.log(`[reader] ${reader.name} returned insufficient content`);
      return null;
    }

    console.log(`[reader] ${reader.name} succeeded (${parsed.markdown.length} chars)`);
    return parsed;
  } catch (err) {
    console.log(`[reader] ${reader.name} failed: ${err instanceof Error ? err.message : "unknown"}`);
    return null;
  }
}

/** Try all free reader proxies in sequence until one succeeds */
async function tryAllReaderProxies(
  url: string,
  excludeReaders: string[] = [],
): Promise<{ markdown: string; title: string } | null> {
  const readers = FREE_READERS.filter((r) => !excludeReaders.includes(r.name));

  for (const reader of readers) {
    // Random delay between reader attempts to appear more human-like
    if (reader.name !== readers[0].name) {
      await randomDelay(500, 1500);
    }

    const result = await tryReaderProxy(reader, url);
    if (result) return result;
  }

  return null;
}

// ─── Main scrape function with enhanced fallback chain ────────────────────────

export async function scrapeUrl(url: string): Promise<{ markdown: string; title: string }> {
  // ── Phase 1: Direct fetch with rotated headers + human-like delay ──
  await randomDelay(300, 1200);

  try {
    const headers = buildBrowserHeaders();
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    // Cloudflare / anti-bot blocks → fallback chain
    if (res.status === 403 || res.status === 503 || res.status === 429 || res.status === 401) {
      console.log(`[scrape] Got ${res.status} for ${url}, entering fallback chain`);
      return await fallbackChain(url);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

    const html = await res.text();

    // Detect Cloudflare challenge page even with 200 status
    if (/cf-challenge|Just a moment|Checking your browser|cf-browser-verification|captchaChallenge/i.test(html) && html.length < 50000) {
      console.log(`[scrape] Cloudflare challenge detected for ${url}, entering fallback chain`);
      return await fallbackChain(url);
    }

    // Detect other common anti-bot pages
    if (/(access denied|blocked|suspended|verify you are human)/i.test(html) && html.length < 30000) {
      console.log(`[scrape] Anti-bot page detected for ${url}, entering fallback chain`);
      return await fallbackChain(url);
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
    return { markdown: htmlToMarkdown(html), title };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.log(`[scrape] Direct fetch failed (${message}), entering fallback chain`);
    return await fallbackChain(url);
  }
}

/** Fallback chain: try multiple free reader proxies sequentially */
async function fallbackChain(url: string): Promise<{ markdown: string; title: string }> {
  // Try free reader proxies
  const readerResult = await tryAllReaderProxies(url);
  if (readerResult) return readerResult;

  // All free proxies exhausted
  throw new Error(
    `All scraping methods failed for ${url}. ` +
    `Tried: direct fetch, Jina Reader, Google Cache, Wayback Machine. ` +
    `Configure a JS renderer (Browserless/custom) in Settings for better results.`,
  );
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
      headers: { "User-Agent": getRandomUA() },
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
        ...buildBrowserHeaders(),
        "Accept": "text/html",
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
      headers: { "User-Agent": getRandomUA() },
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
      headers: { "User-Agent": getRandomUA() },
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
