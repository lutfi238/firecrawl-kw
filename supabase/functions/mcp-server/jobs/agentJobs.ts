import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getAiRequestHeaders,
  getChatCompletionsUrl,
  type AiSettings,
} from "../ai/settings.ts";
import { htmlToMarkdown } from "../scrapers/htmlToMarkdown.ts";
import { extractFreshness } from "../scrapers/freshness.ts";
import {
  decodeEscapedUrl,
  isGoogleNewsRssWrapper,
  isValidArticleUrl,
  normalizeResolvedUrl,
  resolveGoogleNewsUrl,
} from "../scrapers/googleNews.ts";
import {
  dedupeSourcesPreservingSeeds,
  isThinSpaShell,
  rankAndTruncateSources,
} from "../tools/agent/content.ts";
import { getCachedSource, setCachedSource } from "../tools/agent/sourceCache.ts";
import { isAggregatorUrl } from "../tools/agent/sourceFilters.ts";
import { seedUrlsForQuery } from "../tools/agent/seedDocs.ts";
import type { RendererSettings } from "../runtime.ts";

type AcquisitionType =
  | "direct_article"
  | "resolved_article"
  | "unresolved_wrapper"
  | "failed_fetch"
  | "spa_shell";

interface NormalizedSource {
  sourceUrl: string;
  finalUrl?: string;
  title: string;
  publisher: string;
  excerpt: string;
  markdown: string;
  contentLength: number;
  acquisitionType: AcquisitionType;
  resolveStatus: "resolved" | "unchanged" | "failed" | "unresolved_wrapper";
  scrapeStatus:
    | "success"
    | "failed"
    | "unresolved_wrapper"
    | "empty"
    | "boilerplate"
    | "spa_shell";
  freshness: Date | null;
  scrapeMethod?: string;
  error?: string;
}

interface EvidenceMetrics {
  sourcesCollected: number;
  sourcesResolved: number;
  sourcesUnresolvedWrapper: number;
  sourcesScrapedSuccessfully: number;
  sourcesUsableForSynthesis: number;
  sourcesFailed: number;
  sourcesEmpty: number;
  sourcesBoilerplate: number;
  sourcesSpaShell: number;
  sourcesCacheHit: number;
}

interface SearchResult {
  title: string;
  url: string;
  sourceUrl: string;
  snippet: string;
  rawDesc: string;
  acquisitionType: AcquisitionType;
  searchSource: string;
}

interface SearchBatch {
  results: SearchResult[];
  usedEngines: string[];
}

const MIN_USABLE_SEARCH_RESULTS = 3;

function isUsableSearchResult(result: SearchResult): boolean {
  return result.acquisitionType !== "unresolved_wrapper" && !isAggregatorUrl(result.url);
}

function dedupeSearchResults(results: SearchResult[], maxResults: number): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    const key = result.url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
    if (deduped.length >= maxResults) break;
  }
  return deduped;
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function scrapeUrlForAgent(
  url: string,
  rendererSettings?: RendererSettings,
): Promise<{ markdown: string; title: string; freshness: Date | null; scrapeMethod: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" },
    redirect: "follow",
  });
  const html = await res.text();
  if ((res.status === 403 || res.status === 429 || /cloudflare|just a moment|checking your browser/i.test(html)) && rendererSettings?.renderer_provider === "browserless" && rendererSettings.renderer_secret) {
    const rendered = await scrapeWithBrowserless(url, rendererSettings);
    const titleMatch = rendered.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      markdown: htmlToMarkdown(rendered.html),
      title: titleMatch ? titleMatch[1].trim() : url,
      freshness: extractFreshness(rendered.html, new Headers()),
      scrapeMethod: "stealth",
    };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  let titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim() : url;
  let freshness = extractFreshness(html, res.headers);
  let markdown = htmlToMarkdown(html);
  let scrapeMethod = "static";

  if (/__NEXT_DATA__|mintlify/i.test(html) && !freshness && rendererSettings?.renderer_provider === "browserless" && rendererSettings.renderer_secret) {
    const rendered = await scrapeWithBrowserless(url, rendererSettings);
    const renderedFreshness = extractFreshness(rendered.html, new Headers());
    if (renderedFreshness) {
      titleMatch = rendered.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : title;
      freshness = renderedFreshness;
      markdown = htmlToMarkdown(rendered.html);
      scrapeMethod = "stealth";
    }
  }

  if (scrapeMethod !== "stealth" && isThinSpaShell(html, url) && rendererSettings?.renderer_provider === "browserless" && rendererSettings.renderer_secret) {
    const rendered = await scrapeWithBrowserless(url, rendererSettings);
    if (!isThinSpaShell(rendered.html, url)) {
      titleMatch = rendered.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : title;
      freshness = extractFreshness(rendered.html, new Headers());
      markdown = htmlToMarkdown(rendered.html);
      scrapeMethod = "stealth";
    } else {
      scrapeMethod = "spa_shell";
    }
  } else if (scrapeMethod !== "stealth" && isThinSpaShell(html, url)) {
    scrapeMethod = "spa_shell";
  }

  return { markdown, title, freshness, scrapeMethod };
}

async function scrapeWithBrowserless(
  url: string,
  rendererSettings: RendererSettings,
): Promise<{ html: string }> {
  const browserlessUrl = (rendererSettings.renderer_url || "https://production-sfo.browserless.io").replace(/\/+$/, "");
  const endpoint = `${browserlessUrl}/stealth/bql?token=${encodeURIComponent(rendererSettings.renderer_secret || "")}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        mutation AgentScrape($url: String!) {
          goto(url: $url, waitUntil: networkIdle) { status }
          waitForTimeout(time: 2000) { time }
          html { html }
        }
      `,
      variables: { url },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Browserless scrape error ${res.status}`);
  const data = await res.json();
  const html = data.data?.html?.html;
  if (typeof html !== "string") throw new Error("Browserless scrape returned no HTML");
  return { html };
}

function isRedirectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      isGoogleNewsRssWrapper(url) ||
      u.hostname.includes("google.com/rss") ||
      u.hostname.includes("feedproxy.google.com") ||
      u.hostname.includes("t.co") ||
      u.hostname.includes("bit.ly") ||
      u.hostname.includes("ow.ly")
    );
  } catch {
    return false;
  }
}

async function resolveGoogleNewsRssUrl(
  url: string,
  rawDesc?: string,
): Promise<{
  finalUrl?: string;
  resolveStatus: "resolved" | "unresolved_wrapper" | "failed";
  error?: string;
  method?: string;
}> {
  try {
    if (rawDesc) {
      console.log("[gnews-resolve] rawDesc present, length:", rawDesc.length);
      const decoded = rawDesc
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const hrefMatches = [...decoded.matchAll(/href="(https?:\/\/[^"]+)"/gi)];
      for (const hm of hrefMatches) {
        const candidate = normalizeResolvedUrl(hm[1]);
        if (candidate) {
          console.log(
            "[gnews-resolve] Found publisher URL from description href:",
            candidate,
          );
          return {
            finalUrl: candidate,
            resolveStatus: "resolved",
            method: "desc_href",
          };
        }
      }
      const bareUrls = [...decoded.matchAll(/(https?:\/\/[^\s"'<>]+)/gi)];
      for (const bu of bareUrls) {
        const candidate = normalizeResolvedUrl(bu[1]);
        if (candidate) {
          console.log(
            "[gnews-resolve] Found publisher URL from description text:",
            candidate,
          );
          return {
            finalUrl: candidate,
            resolveStatus: "resolved",
            method: "desc_text",
          };
        }
      }
      console.log("[gnews-resolve] No publisher URL found in description");
    } else {
      console.log(
        "[gnews-resolve] rawDesc is MISSING — cannot extract from description",
      );
    }

    const parsed = new URL(url);
    const token = parsed.pathname.split("/").filter(Boolean).pop() || "";
    try {
      const decodedCandidate = await resolveGoogleNewsUrl(url);
      console.log(
        "[gnews-resolve] Decoded publisher URL from wrapper:",
        decodedCandidate,
      );
      return {
        finalUrl: decodedCandidate,
        resolveStatus: "resolved",
        method: "wrapper_decode",
      };
    } catch {
      console.log(
        "[gnews-resolve] Wrapper decode failed for:",
        token.slice(0, 30) + "...",
      );
    }

    console.log("[gnews-resolve] Trying HTTP fetch fallback");
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (res.url && normalizeResolvedUrl(res.url)) {
      console.log("[gnews-resolve] HTTP redirect resolved to:", res.url);
      return {
        finalUrl: res.url,
        resolveStatus: "resolved",
        method: "http_redirect",
      };
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
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(html)) !== null) {
        const candidate = decodeEscapedUrl(m[1] || m[0]);
        const normalized = normalizeResolvedUrl(candidate);
        if (normalized) {
          console.log("[gnews-resolve] Found URL from page HTML:", normalized);
          return {
            finalUrl: normalized,
            resolveStatus: "resolved",
            method: "html_extract",
          };
        }
      }
    }

    console.log("[gnews-resolve] All strategies failed for:", url.slice(0, 80));
    return {
      resolveStatus: "unresolved_wrapper",
      error: "Could not extract publisher URL from Google News RSS wrapper",
    };
  } catch (e) {
    console.log(
      "[gnews-resolve] Error:",
      e instanceof Error ? e.message : "unknown",
    );
    return {
      resolveStatus: "failed",
      error: e instanceof Error ? e.message : "google news resolve failed",
    };
  }
}

async function resolveRedirect(
  url: string,
): Promise<{ finalUrl: string; resolved: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const finalUrl = res.url || url;
    const didChange = finalUrl !== url;
    return { finalUrl, resolved: didChange };
  } catch (e) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
        signal: AbortSignal.timeout(8000),
      });
      const finalUrl = res.url || url;
      await res.body?.cancel();
      const didChange = finalUrl !== url;
      return { finalUrl, resolved: didChange };
    } catch {
      return {
        finalUrl: url,
        resolved: false,
        error: e instanceof Error ? e.message : "resolve failed",
      };
    }
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isUsableArticleContent(markdown: string): boolean {
  if (markdown.length < 300) return false;
  const paragraphs = markdown
    .split(/\n\n+/)
    .filter((p) => p.trim().length > 50);
  if (paragraphs.length < 2) return false;
  const totalTextLength = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const avgParagraphLength = totalTextLength / paragraphs.length;
  if (avgParagraphLength < 40) return false;
  const lower = markdown.toLowerCase();
  const boilerplateSignals = [
    "sign in",
    "log in",
    "subscribe now",
    "cookie policy",
    "accept cookies",
    "privacy policy",
    "terms of service",
  ];
  const boilerplateHits = boilerplateSignals.filter((s) =>
    lower.includes(s),
  ).length;
  if (boilerplateHits >= 3 && markdown.length < 1000) return false;
  return true;
}

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    console.log("[search-ddg] Fetching:", ddgUrl);
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
    const resultBlocks = [
      ...html.matchAll(
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      ),
    ];
    const snippetBlocks = [
      ...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi),
    ];

    for (
      let i = 0;
      i < resultBlocks.length && results.length < maxResults;
      i++
    ) {
      let rawHref = resultBlocks[i][1];
      const rawTitle = resultBlocks[i][2].replace(/<[^>]+>/g, "").trim();

      if (rawHref.includes("uddg=")) {
        const match = rawHref.match(/uddg=([^&]+)/);
        if (match) rawHref = decodeURIComponent(match[1]);
      }

      const check = isValidArticleUrl(rawHref);
      if (!check.valid) {
        console.log(
          "[search-ddg] Skipping non-article:",
          rawHref.slice(0, 80),
          check.reason,
        );
        continue;
      }

      const snippet = snippetBlocks[i]
        ? snippetBlocks[i][1]
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim()
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

    console.log(
      "[search-ddg] Found",
      results.length,
      "direct publisher results",
    );
    return results;
  } catch (e) {
    console.log(
      "[search-ddg] Error:",
      e instanceof Error ? e.message : "unknown",
    );
    return [];
  }
}

async function searchGoogleNewsRss(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
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

    const rawItems: Array<{ title: string; rawLink: string; rawDesc: string }> =
      [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && rawItems.length < maxResults) {
      const item = m[1];
      const titleMatch = item.match(
        /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i,
      );
      const linkMatch = item.match(
        /<link\s*\/?>\s*<!\[CDATA\[(.*?)\]\]>|<link>(.*?)<\/link>|<link\s*\/?>\s*([^<\s]+)/i,
      );
      const guidMatch = item.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
      const descMatch = item.match(
        /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i,
      );
      const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (
        linkMatch?.[1] ||
        linkMatch?.[2] ||
        linkMatch?.[3] ||
        guidMatch?.[1] ||
        ""
      ).trim();
      if (title && rawLink) {
        rawItems.push({
          title,
          rawLink,
          rawDesc: descMatch?.[1] || descMatch?.[2] || "",
        });
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

    for (const r of results) {
      if (r.rawDesc && !r.snippet) {
        const cleaned = r.rawDesc
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/<[^>]+>/g, "")
          .trim();
        if (cleaned.length > 30) r.snippet = cleaned.slice(0, 200);
      }
    }

    console.log(
      "[search-gnews] Found",
      results.length,
      "results (",
      results.filter((r) => r.acquisitionType === "direct_article").length,
      "direct,",
      results.filter((r) => r.acquisitionType === "resolved_article").length,
      "resolved,",
      results.filter((r) => r.acquisitionType === "unresolved_wrapper").length,
      "unresolved)",
    );
    return results;
  } catch (e) {
    console.log(
      "[search-gnews] Error:",
      e instanceof Error ? e.message : "unknown",
    );
    return [];
  }
}

async function searchBingNewsRss(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
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
    let m;
    while ((m = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const item = m[1];
      const titleMatch = item.match(
        /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i,
      );
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
  } catch (e) {
    console.log(
      "[search-bing] Error:",
      e instanceof Error ? e.message : "unknown",
    );
    return [];
  }
}

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!apiKey) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 10)}`;
  try {
    console.log("[search-brave] Fetching Brave Search API");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data.web?.results) ? data.web.results : [];
    return rows.flatMap((row: Record<string, unknown>) => {
      const resultUrl = typeof row.url === "string" ? row.url : "";
      if (!resultUrl || !isValidArticleUrl(resultUrl).valid) return [];
      return [{
        title: typeof row.title === "string" ? row.title : "",
        url: resultUrl,
        sourceUrl: resultUrl,
        snippet: typeof row.description === "string" ? row.description.slice(0, 200) : "",
        rawDesc: "",
        acquisitionType: "direct_article" as const,
        searchSource: "brave",
      }];
    });
  } catch (e) {
    console.log("[search-brave] Error:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

async function searchBingWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = Deno.env.get("BING_SEARCH_API_KEY");
  if (!apiKey) return [];

  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 10)}`;
  try {
    console.log("[search-bing-api] Fetching Bing Web Search API");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data.webPages?.value) ? data.webPages.value : [];
    return rows.flatMap((row: Record<string, unknown>) => {
      const resultUrl = typeof row.url === "string" ? row.url : "";
      if (!resultUrl || !isValidArticleUrl(resultUrl).valid) return [];
      return [{
        title: typeof row.name === "string" ? row.name : "",
        url: resultUrl,
        sourceUrl: resultUrl,
        snippet: typeof row.snippet === "string" ? row.snippet.slice(0, 200) : "",
        rawDesc: "",
        acquisitionType: "direct_article" as const,
        searchSource: "bing_api",
      }];
    });
  } catch (e) {
    console.log("[search-bing-api] Error:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

function seedSearchResults(query: string): SearchResult[] {
  return seedUrlsForQuery(query).map((url) => ({
    title: "",
    url,
    sourceUrl: url,
    snippet: "",
    rawDesc: "",
    acquisitionType: "direct_article" as const,
    searchSource: "seed_docs",
  }));
}


async function searchWeb(
  query: string,
  maxResults: number,
): Promise<SearchBatch> {
  console.log(
    "[search] Starting fallback search for:",
    query,
    "max:",
    maxResults,
  );

  const usedEngines: string[] = [];
  let results = seedSearchResults(query);
  if (results.length > 0) usedEngines.push("seed_docs");

  const ddgResults = await searchDuckDuckGo(query, maxResults);
  usedEngines.push("duckduckgo");
  results = dedupeSearchResults([...results, ...ddgResults], maxResults);
  if (results.filter(isUsableSearchResult).length >= MIN_USABLE_SEARCH_RESULTS) {
    return { results, usedEngines };
  }

  const braveResults = await searchBrave(query, maxResults);
  if (Deno.env.get("BRAVE_SEARCH_API_KEY")) usedEngines.push("brave");
  results = dedupeSearchResults([...results, ...braveResults], maxResults);
  if (results.filter(isUsableSearchResult).length >= MIN_USABLE_SEARCH_RESULTS) {
    return { results, usedEngines };
  }

  const bingResults = await searchBingWeb(query, maxResults);
  if (Deno.env.get("BING_SEARCH_API_KEY")) usedEngines.push("bing");
  results = dedupeSearchResults([...results, ...bingResults], maxResults);
  if (results.filter(isUsableSearchResult).length >= MIN_USABLE_SEARCH_RESULTS) {
    return { results, usedEngines };
  }

  console.log(
    "[search] Fallback results:",
    results.length,
    "usable:",
    results.filter(isUsableSearchResult).length,
  );
  return { results, usedEngines };
}

function normalizeFocusUrls(rawUrls: unknown): string[] {
  if (Array.isArray(rawUrls)) {
    return rawUrls.filter(Boolean) as string[];
  }

  if (typeof rawUrls === "string" && rawUrls.trim()) {
    return rawUrls
      .split(",")
      .map((u: string) => u.trim())
      .filter(Boolean);
  }

  return [];
}

async function collectDiscoveredUrls(
  focusUrls: string[],
  prompt: string,
  maxSteps: number,
): Promise<{ urls: SearchResult[]; usedEngines: string[]; seedUrls: string[] }> {
  const usedEngines: string[] = [];
  const seedUrls: string[] = [];
  const discoveredUrls: SearchResult[] = [];

  for (const u of focusUrls) {
    const check = isValidArticleUrl(u);
    if (!check.valid) {
      console.log("[agent] Rejecting user URL:", u.slice(0, 80), check.reason);
      continue;
    }

    if (isGoogleNewsRssWrapper(u)) {
      const resolved = await resolveGoogleNewsRssUrl(u);
      if (resolved.finalUrl && resolved.resolveStatus === "resolved") {
        discoveredUrls.push({
          title: "",
          url: resolved.finalUrl,
          sourceUrl: u,
          snippet: "",
          rawDesc: "",
          acquisitionType: "resolved_article",
          searchSource: "user_provided",
        });
      }
      continue;
    }

    if (isRedirectUrl(u)) {
      const resolved = await resolveRedirect(u);
      const finalCheck = isValidArticleUrl(resolved.finalUrl);
      if (finalCheck.valid) {
        discoveredUrls.push({
          title: "",
          url: resolved.finalUrl,
          sourceUrl: u,
          snippet: "",
          rawDesc: "",
          acquisitionType: resolved.resolved ? "resolved_article" : "direct_article",
          searchSource: "user_provided",
        });
      } else {
        console.log(
          "[agent] Resolved user URL rejected:",
          resolved.finalUrl.slice(0, 80),
          finalCheck.reason,
        );
      }
      continue;
    }

    discoveredUrls.push({
      title: "",
      url: u,
      sourceUrl: u,
      snippet: "",
      rawDesc: "",
      acquisitionType: "direct_article",
      searchSource: "user_provided",
    });
  }

  console.log(
    "[agent] Focus URLs:",
    focusUrls.length,
    "accepted:",
    discoveredUrls.length,
  );

  if (discoveredUrls.length < maxSteps) {
    console.log("[agent] Searching web for:", prompt);
    const searchResults = await searchWeb(
      prompt,
      maxSteps - discoveredUrls.length,
    );
    usedEngines.push(...searchResults.usedEngines);
    seedUrls.push(
      ...searchResults.results
        .filter((r) => r.searchSource === "seed_docs")
        .map((r) => r.url),
    );
    console.log("[agent] Search returned", searchResults.results.length, "results");
    for (const r of searchResults.results) discoveredUrls.push(r);
  }

  return { urls: discoveredUrls, usedEngines, seedUrls };
}

function buildEvidenceMetrics(
  sources: NormalizedSource[],
  collectedCount: number,
): EvidenceMetrics {
  return {
    sourcesCollected: collectedCount,
    sourcesResolved: sources.filter((s) => s.resolveStatus === "resolved")
      .length,
    sourcesUnresolvedWrapper: sources.filter(
      (s) => s.acquisitionType === "unresolved_wrapper",
    ).length,
    sourcesScrapedSuccessfully: sources.filter(
      (s) => s.scrapeStatus === "success",
    ).length,
    sourcesUsableForSynthesis: sources.filter(
      (s) => s.scrapeStatus === "success",
    ).length,
    sourcesFailed: sources.filter((s) => s.scrapeStatus === "failed").length,
    sourcesEmpty: sources.filter((s) => s.scrapeStatus === "empty").length,
    sourcesSpaShell: sources.filter((s) => s.scrapeStatus === "spa_shell").length,
    sourcesCacheHit: sources.filter((s) => s.scrapeMethod === "cache").length,
    sourcesBoilerplate: sources.filter((s) => s.scrapeStatus === "boilerplate")
      .length,
  };
}

function buildSourceSummary(sources: NormalizedSource[]) {
  return sources.map((s) => ({
    sourceUrl: s.sourceUrl,
    finalUrl: s.finalUrl,
    title: s.title,
    publisher: s.publisher,
    contentLength: s.contentLength,
    acquisitionType: s.acquisitionType,
    resolveStatus: s.resolveStatus,
    freshness: s.freshness?.toISOString() ?? null,
    scrapeMethod: s.scrapeMethod,
    scrapeStatus: s.scrapeStatus,
    error: s.error,
  }));
}
async function collectSources(
  svc: ReturnType<typeof getServiceClient>,
  jobId: string,
  discoveredUrls: SearchResult[],
  collectedCount: number,
  rendererSettings: RendererSettings,
): Promise<NormalizedSource[]> {
  const sources: NormalizedSource[] = [];

  for (const item of discoveredUrls) {
    if (item.acquisitionType === "unresolved_wrapper") continue;
    if (isAggregatorUrl(item.url)) {
      console.log("[agent] Dropping aggregator source:", item.url.slice(0, 80));
      continue;
    }

    let finalUrl: string | undefined = item.url;
    let resolveStatus: NormalizedSource["resolveStatus"] =
      item.acquisitionType === "resolved_article" ? "resolved" : "unchanged";

    if (isRedirectUrl(item.url) && !isGoogleNewsRssWrapper(item.url)) {
      const resolved = await resolveRedirect(item.url);
      finalUrl = resolved.finalUrl;
      resolveStatus = resolved.resolved ? "resolved" : "unchanged";
    }

    if (isAggregatorUrl(finalUrl) || !isValidArticleUrl(finalUrl).valid) {
      console.log("[agent] Dropping resolved aggregator/invalid source:", finalUrl.slice(0, 80));
      continue;
    }

    let title = item.title;
    let markdown = "";
    let scrapeStatus: NormalizedSource["scrapeStatus"] = "failed";
    let scrapeError: string | undefined;
    let freshness: Date | null = null;
    let scrapeMethod = "static";

    try {
      const cached = await getCachedSource(svc, finalUrl);
      if (cached) {
        markdown = cached.content;
        title = title || cached.title;
        freshness = cached.freshness;
        scrapeMethod = "cache";
      } else {
        const scraped = await scrapeUrlForAgent(finalUrl, rendererSettings);
        markdown = scraped.markdown;
        title = title || scraped.title;
        freshness = scraped.freshness;
        scrapeMethod = scraped.scrapeMethod;
        await setCachedSource(svc, finalUrl, {
          content: markdown,
          title: title || finalUrl,
          freshness,
          scrapeMethod,
        });
      }
      scrapeStatus = scrapeMethod === "spa_shell"
        ? "spa_shell"
        : isUsableArticleContent(markdown)
          ? "success"
          : markdown.length > 0
            ? "boilerplate"
            : "empty";
      console.log(
        "[agent] Scraped:",
        finalUrl.slice(0, 80),
        "type:",
        item.acquisitionType,
        "len:",
        markdown.length,
        "status:",
        scrapeStatus,
        "source:",
        item.searchSource,
      );
    } catch (e) {
      scrapeError = e instanceof Error ? e.message : "scrape failed";
      console.log("[agent] Scrape failed:", finalUrl, scrapeError);
    }

    sources.push({
      sourceUrl: item.sourceUrl,
      finalUrl,
      title: title || extractDomain(finalUrl || item.url),
      publisher: extractDomain(finalUrl || item.url),
      excerpt: item.snippet || markdown.slice(0, 200),
      markdown,
      contentLength: markdown.length,
      acquisitionType: scrapeStatus === "spa_shell" ? "spa_shell" : item.acquisitionType,
      resolveStatus,
      scrapeStatus,
      freshness,
      scrapeMethod,
      error: scrapeError,
    });

    await svc
      .from("mcp_jobs")
      .update({
        output: {
          step: "scraping",
          sourcesCollected: collectedCount,
          scrapedCount: sources.filter((s) => s.scrapeStatus === "success").length,
          totalSources: collectedCount,
        },
      })
      .eq("id", jobId);
  }

  return sources;
}

async function completeWithNoSources(
  svc: ReturnType<typeof getServiceClient>,
  jobId: string,
  warning: string,
  metrics: EvidenceMetrics,
  sources: Array<Record<string, unknown>>,
  diagnostics: {
    attemptedEngines: string[];
    attemptedSeedUrls: string[];
    wrapperResolveFailures: number;
  },
) {
  await svc
    .from("mcp_jobs")
    .update({
      status: "completed",
      output: {
        step: "completed",
        synthesis: null,
        error: "NO_GROUNDED_SOURCES",
        groundedness: "none",
        warning,
        diagnostic: {
          ...diagnostics,
          suggestion: "Try the `fetch` tool with a specific URL, or rephrase the query.",
        },
        evidenceMetrics: metrics,
        sources,
        scrapedCount: 0,
      },
    })
    .eq("id", jobId);
}

export async function processAgentJob(
  jobId: string,
  args: Record<string, unknown>,
  aiSettings: AiSettings,
  rendererSettings: RendererSettings = {},
) {
  const svc = getServiceClient();

  try {
    await svc
      .from("mcp_jobs")
      .update({ status: "processing", output: { step: "searching" } })
      .eq("id", jobId);

    const prompt = args.prompt as string;
    const focusUrls = normalizeFocusUrls(args.urls);
    const schema = args.schema as string | undefined;
    const maxSteps = (args.maxSteps as number) || 5;
    const discovery = await collectDiscoveredUrls(
      focusUrls,
      prompt,
      maxSteps,
    );
    let discoveredUrls = discovery.urls;
    const noSourceDiagnostics = {
      attemptedEngines: discovery.usedEngines,
      attemptedSeedUrls: discovery.seedUrls,
      wrapperResolveFailures: 0,
    };

    if (discoveredUrls.length === 0) {
      console.log("[agent] No URLs discovered — returning low-evidence result");
      const emptyMetrics: EvidenceMetrics = {
        sourcesCollected: 0,
        sourcesResolved: 0,
        sourcesUnresolvedWrapper: 0,
        sourcesScrapedSuccessfully: 0,
        sourcesUsableForSynthesis: 0,
        sourcesFailed: 0,
        sourcesEmpty: 0,
        sourcesBoilerplate: 0,
        sourcesSpaShell: 0,
        sourcesCacheHit: 0,
      };
      await completeWithNoSources(
        svc,
        jobId,
        "Web search returned no relevant URLs.",
        emptyMetrics,
        [],
        noSourceDiagnostics,
      );
      return;
    }

    discoveredUrls = discoveredUrls.slice(0, maxSteps);
    const collectedCount = discoveredUrls.length;
    const scrapeable = discoveredUrls.filter(
      (r) => r.acquisitionType !== "unresolved_wrapper",
    );
    if (scrapeable.length === 0) {
      console.log(
        "[agent] All",
        collectedCount,
        "results are unresolved wrappers — returning low-evidence",
      );
      const wrapperMetrics: EvidenceMetrics = {
        sourcesCollected: collectedCount,
        sourcesResolved: 0,
        sourcesUnresolvedWrapper: collectedCount,
        sourcesScrapedSuccessfully: 0,
        sourcesUsableForSynthesis: 0,
        sourcesFailed: 0,
        sourcesEmpty: 0,
        sourcesBoilerplate: 0,
        sourcesSpaShell: 0,
        sourcesCacheHit: 0,
      };
      const wrapperSummary = discoveredUrls.map((r) => ({
        sourceUrl: r.sourceUrl,
        finalUrl: undefined,
        title: r.title,
        publisher: extractDomain(r.sourceUrl),
        contentLength: 0,
        acquisitionType: r.acquisitionType,
        resolveStatus: "unresolved_wrapper" as const,
        scrapeStatus: "unresolved_wrapper" as const,
      }));
      await completeWithNoSources(
        svc,
        jobId,
        "All discovered sources were Google News wrappers that could not be resolved to publisher URLs.",
        wrapperMetrics,
        wrapperSummary,
        noSourceDiagnostics,
      );
      return;
    }

    await svc
      .from("mcp_jobs")
      .update({
        output: { step: "scraping", sourcesCollected: collectedCount },
      })
      .eq("id", jobId);

    let sources = await collectSources(
      svc,
      jobId,
      discoveredUrls,
      collectedCount,
      rendererSettings,
    );
    sources = dedupeSourcesPreservingSeeds(sources, discovery.seedUrls);

    const budgetTokens = Number(Deno.env.get("AGENT_MAX_CONTEXT_TOKENS") ?? "6000");
    const promptReserve = 1500;
    const budgetChars = Math.max(3000, (budgetTokens - promptReserve) * 4);
    sources = rankAndTruncateSources(sources, budgetChars, prompt).map((source) => ({
      ...source,
      contentLength: source.markdown.length,
    }));
    const finalMetrics = buildEvidenceMetrics(sources, collectedCount);

    console.log("[agent] Evidence metrics:", JSON.stringify(finalMetrics));
    const sourceSummary = buildSourceSummary(sources);
    const usableSources = sources.filter((s) => s.scrapeStatus === "success");

    if (usableSources.length === 0) {
      console.log(
        "[agent] No usable article content — returning low-evidence result",
      );
      await completeWithNoSources(
        svc,
        jobId,
        "No usable article content could be extracted from any source.",
        finalMetrics,
        sourceSummary,
        noSourceDiagnostics,
      );
      return;
    }

    const isWeakEvidence =
      usableSources.length <= 1 || usableSources.length < collectedCount * 0.3;

    await svc
      .from("mcp_jobs")
      .update({
        output: {
          step: "synthesizing",
          scrapedCount: finalMetrics.sourcesScrapedSuccessfully,
          evidenceMetrics: finalMetrics,
          sources: sourceSummary,
        },
      })
      .eq("id", jobId);

    const evidenceText = usableSources
      .map(
        (s) =>
          `# ${s.title}\nSource: ${s.publisher} (${s.finalUrl})\n\n${s.markdown}`,
      )
      .join("\n\n---\n\n");

    const synthesisInstructions = [
      "You are a research agent that synthesizes information ONLY from the provided source evidence.",
      "CRITICAL RULES:",
      "1. Base ALL findings exclusively on the provided scraped article content below.",
      "2. Do NOT substitute your own background knowledge when the evidence is insufficient.",
      "3. If the provided evidence does not adequately address the research prompt, explicitly state that the evidence is insufficient rather than filling gaps with general knowledge.",
      "4. Clearly distinguish between claims directly supported by the evidence and any contextual framing.",
      "5. Cite specific sources by title/publisher when making claims.",
      schema
        ? `6. Return valid JSON matching this schema: ${schema}`
        : "6. Provide a comprehensive, well-structured markdown response.",
      isWeakEvidence
        ? `\nNOTE: Evidence quality is LOW — only ${usableSources.length} of ${collectedCount} sources yielded usable article content. Acknowledge this limitation in your response.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const aiRes = await fetch(getChatCompletionsUrl(aiSettings), {
      method: "POST",
      headers: getAiRequestHeaders(aiSettings),
      body: JSON.stringify({
        model: aiSettings.model,
        messages: [
          { role: "system", content: synthesisInstructions },
          {
            role: "user",
            content: `Research prompt: ${prompt}\n\n---SOURCE EVIDENCE (${usableSources.length} articles)---\n\n${evidenceText}`,
          },
        ],
        max_tokens: 8192,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI API error ${aiRes.status}: ${errText.slice(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const answer = aiData.choices?.[0]?.message?.content;
    const groundedness =
      usableSources.length >= 3
        ? "high"
        : usableSources.length >= 2
          ? "medium"
          : "low";
    const freshnessDates = sources
      .map((s) => s.freshness)
      .filter((date): date is Date => date instanceof Date);
    const evidenceFreshnessMax = freshnessDates.length
      ? new Date(Math.max(...freshnessDates.map((date) => date.getTime()))).toISOString()
      : null;
    const trainingCutoff = new Date("2024-06-01");
    const knowledgeMetadata = {
      subAgentModel: Deno.env.get("AGENT_LLM_MODEL") || aiSettings.model,
      subAgentTrainingCutoff: "2024-06-01",
      evidenceFreshnessMax,
      evidenceFresherThanModel: !!evidenceFreshnessMax && new Date(evidenceFreshnessMax) > trainingCutoff,
    };

    await svc
      .from("mcp_jobs")
      .update({
        status: "completed",
        output: {
          step: "completed",
          synthesis: answer || "No response from AI",
          groundedness,
          ...(isWeakEvidence
            ? {
                warning: `Only ${usableSources.length} of ${collectedCount} sources yielded usable article content. Synthesis may have limited grounding.`,
              }
            : {}),
          evidenceMetrics: finalMetrics,
          sources: sourceSummary,
          sourcesUsed: usableSources
            .map((s) => s.finalUrl)
            .filter((u): u is string => typeof u === "string"),
          scrapedCount: finalMetrics.sourcesScrapedSuccessfully,
          knowledgeMetadata,
        },
      })
      .eq("id", jobId);
  } catch (err) {
    await svc
      .from("mcp_jobs")
      .update({
        status: "failed",
        output: { error: err instanceof Error ? err.message : "Unknown error" },
      })
      .eq("id", jobId);
  }
}
