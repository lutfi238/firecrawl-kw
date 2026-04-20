import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { htmlToMarkdown } from "../scrapers/htmlToMarkdown.ts";
import { decodeEscapedUrl, decodeGoogleNewsToken, isGoogleNewsRssWrapper, isValidArticleUrl, normalizeResolvedUrl } from "../scrapers/googleNews.ts";

type AcquisitionType = "direct_article" | "resolved_article" | "unresolved_wrapper" | "failed_fetch";

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
  scrapeStatus: "success" | "failed" | "unresolved_wrapper" | "empty" | "boilerplate";
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

interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function scrapeUrl(url: string): Promise<{ markdown: string; title: string }> {
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

async function resolveGoogleNewsRssUrl(url: string, rawDesc?: string): Promise<{ finalUrl?: string; resolveStatus: "resolved" | "unresolved_wrapper" | "failed"; error?: string; method?: string }> {
  try {
    if (rawDesc) {
      console.log("[gnews-resolve] rawDesc present, length:", rawDesc.length);
      const decoded = rawDesc
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const hrefMatches = [...decoded.matchAll(/href="(https?:\/\/[^\"]+)"/gi)];
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
      /data-url="(https?:\/\/[^\"]+)"/gi,
      /href="(https?:\/\/[^\"]+)"/gi,
    ];

    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(html)) !== null) {
        const candidate = decodeEscapedUrl(m[1] || m[0]);
        const normalized = normalizeResolvedUrl(candidate);
        if (normalized) {
          console.log("[gnews-resolve] Found URL from page HTML:", normalized);
          return { finalUrl: normalized, resolveStatus: "resolved", method: "html_extract" };
        }
      }
    }

    console.log("[gnews-resolve] All strategies failed for:", url.slice(0, 80));
    return { resolveStatus: "unresolved_wrapper", error: "Could not extract publisher URL from Google News RSS wrapper" };
  } catch (e) {
    console.log("[gnews-resolve] Error:", e instanceof Error ? e.message : "unknown");
    return { resolveStatus: "failed", error: e instanceof Error ? e.message : "google news resolve failed" };
  }
}

async function resolveRedirect(url: string): Promise<{ finalUrl: string; resolved: boolean; error?: string }> {
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
      return { finalUrl: url, resolved: false, error: e instanceof Error ? e.message : "resolve failed" };
    }
  }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function isUsableArticleContent(markdown: string): boolean {
  if (markdown.length < 300) return false;
  const paragraphs = markdown.split(/\n\n+/).filter(p => p.trim().length > 50);
  if (paragraphs.length < 2) return false;
  const totalTextLength = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const avgParagraphLength = totalTextLength / paragraphs.length;
  if (avgParagraphLength < 40) return false;
  const lower = markdown.toLowerCase();
  const boilerplateSignals = [
    "sign in", "log in", "subscribe now", "cookie policy",
    "accept cookies", "privacy policy", "terms of service",
  ];
  const boilerplateHits = boilerplateSignals.filter(s => lower.includes(s)).length;
  if (boilerplateHits >= 3 && markdown.length < 1000) return false;
  return true;
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    console.log("[search-ddg] Fetching:", ddgUrl);
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
  } catch (e) {
    console.log("[search-ddg] Error:", e instanceof Error ? e.message : "unknown");
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
    if (!res.ok) { console.log("[search-gnews] HTTP", res.status); return []; }
    const xml = await res.text();

    const rawItems: Array<{ title: string; rawLink: string; rawDesc: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && rawItems.length < maxResults) {
      const item = m[1];
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const linkMatch = item.match(/<link\s*\/?>\s*<!\[CDATA\[(.*?)\]\]>|<link>(.*?)<\/link>|<link\s*\/?>\s*([^<\s]+)/i);
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
            title, url: resolved.finalUrl, sourceUrl: rawLink,
            snippet: "", rawDesc,
            acquisitionType: "resolved_article",
            searchSource: "google_news_rss",
          });
        } else {
          results.push({
            title, url: rawLink, sourceUrl: rawLink,
            snippet: "", rawDesc,
            acquisitionType: "unresolved_wrapper",
            searchSource: "google_news_rss",
          });
        }
      } else {
        results.push({
          title, url: rawLink, sourceUrl: rawLink,
          snippet: "", rawDesc,
          acquisitionType: "direct_article",
          searchSource: "google_news_rss",
        });
      }
    }

    for (const r of results) {
      if (r.rawDesc && !r.snippet) {
        const cleaned = r.rawDesc
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
          .replace(/<[^>]+>/g, "").trim();
        if (cleaned.length > 30) r.snippet = cleaned.slice(0, 200);
      }
    }

    console.log("[search-gnews] Found", results.length, "results (",
      results.filter(r => r.acquisitionType === "direct_article").length, "direct,",
      results.filter(r => r.acquisitionType === "resolved_article").length, "resolved,",
      results.filter(r => r.acquisitionType === "unresolved_wrapper").length, "unresolved)");
    return results;
  } catch (e) {
    console.log("[search-gnews] Error:", e instanceof Error ? e.message : "unknown");
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
    if (!res.ok) { console.log("[search-bing] HTTP", res.status); return []; }
    const xml = await res.text();
    const results: SearchResult[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const item = m[1];
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const linkMatch = item.match(/<link>(.*?)<\/link>/i);
      const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (linkMatch?.[1] || "").trim();
      if (title && rawLink && isValidArticleUrl(rawLink).valid) {
        results.push({
          title, url: rawLink, sourceUrl: rawLink,
          snippet: "", rawDesc: "",
          acquisitionType: "direct_article",
          searchSource: "bing_rss",
        });
      }
    }
    console.log("[search-bing] Found", results.length, "direct results");
    return results;
  } catch (e) {
    console.log("[search-bing] Error:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  console.log("[search] Starting multi-source search for:", query, "max:", maxResults);
  const [ddgResults, bingResults, gnewsResults] = await Promise.all([
    searchDuckDuckGo(query, maxResults),
    searchBingNewsRss(query, maxResults),
    searchGoogleNewsRss(query, maxResults),
  ]);

  const allResults: SearchResult[] = [];
  for (const r of ddgResults) allResults.push(r);
  for (const r of bingResults) allResults.push(r);
  for (const r of gnewsResults.filter(r => r.acquisitionType === "resolved_article")) allResults.push(r);
  for (const r of gnewsResults.filter(r => r.acquisitionType === "direct_article")) allResults.push(r);
  for (const r of gnewsResults.filter(r => r.acquisitionType === "unresolved_wrapper")) allResults.push(r);

  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of allResults) {
    const key = r.url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const final = deduped.slice(0, maxResults);
  console.log("[search] Combined results:", final.length,
    "| direct:", final.filter(r => r.acquisitionType === "direct_article").length,
    "| resolved:", final.filter(r => r.acquisitionType === "resolved_article").length,
    "| unresolved:", final.filter(r => r.acquisitionType === "unresolved_wrapper").length);
  return final;
}

function normalizeFocusUrls(rawUrls: unknown): string[] {
  if (Array.isArray(rawUrls)) {
    return rawUrls.filter(Boolean) as string[];
  }

  if (typeof rawUrls === "string" && rawUrls.trim()) {
    return rawUrls.split(",").map((u: string) => u.trim()).filter(Boolean);
  }

  return [];
}

async function collectDiscoveredUrls(focusUrls: string[], prompt: string, maxSteps: number): Promise<SearchResult[]> {
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
        discoveredUrls.push({ title: "", url: resolved.finalUrl, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "resolved_article", searchSource: "user_provided" });
      } else {
        discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "unresolved_wrapper", searchSource: "user_provided" });
      }
      continue;
    }

    if (isRedirectUrl(u)) {
      const resolved = await resolveRedirect(u);
      const finalCheck = isValidArticleUrl(resolved.finalUrl);
      if (finalCheck.valid) {
        discoveredUrls.push({ title: "", url: resolved.finalUrl, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: resolved.resolved ? "resolved_article" : "direct_article", searchSource: "user_provided" });
      } else {
        console.log("[agent] Resolved user URL rejected:", resolved.finalUrl.slice(0, 80), finalCheck.reason);
      }
      continue;
    }

    discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "direct_article", searchSource: "user_provided" });
  }

  console.log("[agent] Focus URLs:", focusUrls.length, "accepted:", discoveredUrls.length);

  if (discoveredUrls.length < maxSteps) {
    console.log("[agent] Searching web for:", prompt);
    const searchResults = await searchWeb(prompt, maxSteps - discoveredUrls.length);
    console.log("[agent] Search returned", searchResults.length, "results");
    for (const r of searchResults) discoveredUrls.push(r);
  }

  return discoveredUrls;
}

function buildEvidenceMetrics(sources: NormalizedSource[], collectedCount: number): EvidenceMetrics {
  return {
    sourcesCollected: collectedCount,
    sourcesResolved: sources.filter(s => s.resolveStatus === "resolved").length,
    sourcesUnresolvedWrapper: sources.filter(s => s.acquisitionType === "unresolved_wrapper").length,
    sourcesScrapedSuccessfully: sources.filter(s => s.scrapeStatus === "success").length,
    sourcesUsableForSynthesis: sources.filter(s => s.scrapeStatus === "success").length,
    sourcesFailed: sources.filter(s => s.scrapeStatus === "failed").length,
    sourcesEmpty: sources.filter(s => s.scrapeStatus === "empty").length,
    sourcesBoilerplate: sources.filter(s => s.scrapeStatus === "boilerplate").length,
  };
}

function buildSourceSummary(sources: NormalizedSource[]) {
  return sources.map(s => ({
    sourceUrl: s.sourceUrl,
    finalUrl: s.finalUrl,
    title: s.title,
    publisher: s.publisher,
    contentLength: s.contentLength,
    acquisitionType: s.acquisitionType,
    resolveStatus: s.resolveStatus,
    scrapeStatus: s.scrapeStatus,
    error: s.error,
  }));
}

async function collectSources(
  svc: ReturnType<typeof getServiceClient>,
  jobId: string,
  discoveredUrls: SearchResult[],
  collectedCount: number,
): Promise<NormalizedSource[]> {
  const sources: NormalizedSource[] = [];

  for (const item of discoveredUrls) {
    if (item.acquisitionType === "unresolved_wrapper") {
      console.log("[agent] Skipping unresolved wrapper:", item.url.slice(0, 80));
      sources.push({
        sourceUrl: item.sourceUrl, finalUrl: undefined,
        title: item.title || extractDomain(item.sourceUrl),
        publisher: extractDomain(item.sourceUrl),
        excerpt: item.snippet, markdown: "", contentLength: 0,
        acquisitionType: "unresolved_wrapper",
        resolveStatus: "unresolved_wrapper", scrapeStatus: "unresolved_wrapper",
      });
      continue;
    }

    let finalUrl: string | undefined = item.url;
    let resolveStatus: NormalizedSource["resolveStatus"] = item.acquisitionType === "resolved_article" ? "resolved" : "unchanged";

    if (isRedirectUrl(item.url) && !isGoogleNewsRssWrapper(item.url)) {
      const resolved = await resolveRedirect(item.url);
      finalUrl = resolved.finalUrl;
      resolveStatus = resolved.resolved ? "resolved" : "unchanged";
    }

    let title = item.title;
    let markdown = "";
    let scrapeStatus: NormalizedSource["scrapeStatus"] = "failed";
    let scrapeError: string | undefined;

    try {
      const scraped = await scrapeUrl(finalUrl!);
      markdown = scraped.markdown.slice(0, 6000);
      title = title || scraped.title;
      scrapeStatus = isUsableArticleContent(markdown) ? "success" : (markdown.length > 0 ? "boilerplate" : "empty");
      console.log("[agent] Scraped:", finalUrl!.slice(0, 80), "type:", item.acquisitionType, "len:", markdown.length, "status:", scrapeStatus, "source:", item.searchSource);
    } catch (e) {
      scrapeError = e instanceof Error ? e.message : "scrape failed";
      console.log("[agent] Scrape failed:", finalUrl, scrapeError);
    }

    sources.push({
      sourceUrl: item.sourceUrl, finalUrl,
      title: title || extractDomain(finalUrl || item.url),
      publisher: extractDomain(finalUrl || item.url),
      excerpt: item.snippet || markdown.slice(0, 200),
      markdown, contentLength: markdown.length,
      acquisitionType: item.acquisitionType,
      resolveStatus, scrapeStatus,
      error: scrapeError,
    });

    await svc.from("mcp_jobs").update({
      output: { step: "scraping", sourcesCollected: collectedCount, scrapedCount: sources.filter(s => s.scrapeStatus === "success").length, totalSources: collectedCount },
    }).eq("id", jobId);
  }

  return sources;
}

async function completeWithNoSources(
  svc: ReturnType<typeof getServiceClient>,
  jobId: string,
  warning: string,
  metrics: EvidenceMetrics,
  sources: Array<Record<string, unknown>>,
) {
  await svc.from("mcp_jobs").update({
    status: "completed",
    output: { step: "completed", synthesis: null, groundedness: "none", warning, evidenceMetrics: metrics, sources, scrapedCount: 0 },
  }).eq("id", jobId);
}

export async function processAgentJob(jobId: string, args: Record<string, unknown>, aiSettings: AiSettings) {
  const svc = getServiceClient();

  try {
    await svc.from("mcp_jobs").update({ status: "processing", output: { step: "searching" } }).eq("id", jobId);

    const prompt = args.prompt as string;
    const focusUrls = normalizeFocusUrls(args.urls);
    const schema = args.schema as string | undefined;
    const maxSteps = (args.maxSteps as number) || 5;

    let discoveredUrls = await collectDiscoveredUrls(focusUrls, prompt, maxSteps);

    if (discoveredUrls.length === 0) {
      console.log("[agent] No URLs discovered — returning low-evidence result");
      const emptyMetrics: EvidenceMetrics = { sourcesCollected: 0, sourcesResolved: 0, sourcesUnresolvedWrapper: 0, sourcesScrapedSuccessfully: 0, sourcesUsableForSynthesis: 0, sourcesFailed: 0, sourcesEmpty: 0, sourcesBoilerplate: 0 };
      await completeWithNoSources(svc, jobId, "Web search returned no relevant URLs.", emptyMetrics, []);
      return;
    }

    discoveredUrls = discoveredUrls.slice(0, maxSteps);
    const collectedCount = discoveredUrls.length;
    const scrapeable = discoveredUrls.filter(r => r.acquisitionType !== "unresolved_wrapper");
    if (scrapeable.length === 0) {
      console.log("[agent] All", collectedCount, "results are unresolved wrappers — returning low-evidence");
      const wrapperMetrics: EvidenceMetrics = { sourcesCollected: collectedCount, sourcesResolved: 0, sourcesUnresolvedWrapper: collectedCount, sourcesScrapedSuccessfully: 0, sourcesUsableForSynthesis: 0, sourcesFailed: 0, sourcesEmpty: 0, sourcesBoilerplate: 0 };
      const wrapperSummary = discoveredUrls.map(r => ({ sourceUrl: r.sourceUrl, finalUrl: undefined, title: r.title, publisher: extractDomain(r.sourceUrl), contentLength: 0, acquisitionType: r.acquisitionType, resolveStatus: "unresolved_wrapper" as const, scrapeStatus: "unresolved_wrapper" as const }));
      await completeWithNoSources(svc, jobId, "All discovered sources were Google News wrappers that could not be resolved to publisher URLs.", wrapperMetrics, wrapperSummary);
      return;
    }

    await svc.from("mcp_jobs").update({ output: { step: "scraping", sourcesCollected: collectedCount } }).eq("id", jobId);

    const sources = await collectSources(svc, jobId, discoveredUrls, collectedCount);
    const metrics = buildEvidenceMetrics(sources, collectedCount);

    console.log("[agent] Evidence metrics:", JSON.stringify(metrics));

    const sourceSummary = buildSourceSummary(sources);

    const usableSources = sources.filter(s => s.scrapeStatus === "success");

    if (usableSources.length === 0) {
      console.log("[agent] No usable article content — returning low-evidence result");
      await svc.from("mcp_jobs").update({
        status: "completed",
        output: { step: "completed", synthesis: null, groundedness: "none", warning: "No usable article content could be extracted from any source.", evidenceMetrics: metrics, sources: sourceSummary, scrapedCount: 0 },
      }).eq("id", jobId);
      return;
    }

    const isWeakEvidence = usableSources.length <= 1 || usableSources.length < collectedCount * 0.3;

    await svc.from("mcp_jobs").update({
      output: { step: "synthesizing", scrapedCount: metrics.sourcesScrapedSuccessfully, evidenceMetrics: metrics, sources: sourceSummary },
    }).eq("id", jobId);

    const evidenceText = usableSources.map(s =>
      `# ${s.title}\nSource: ${s.publisher} (${s.finalUrl})\n\n${s.markdown}`
    ).join("\n\n---\n\n");

    const synthesisInstructions = [
      "You are a research agent that synthesizes information ONLY from the provided source evidence.",
      "CRITICAL RULES:",
      "1. Base ALL findings exclusively on the provided scraped article content below.",
      "2. Do NOT substitute your own background knowledge when the evidence is insufficient.",
      "3. If the provided evidence does not adequately address the research prompt, explicitly state that the evidence is insufficient rather than filling gaps with general knowledge.",
      "4. Clearly distinguish between claims directly supported by the evidence and any contextual framing.",
      "5. Cite specific sources by title/publisher when making claims.",
      schema ? `6. Return valid JSON matching this schema: ${schema}` : "6. Provide a comprehensive, well-structured markdown response.",
      isWeakEvidence ? `\nNOTE: Evidence quality is LOW — only ${usableSources.length} of ${collectedCount} sources yielded usable article content. Acknowledge this limitation in your response.` : "",
    ].filter(Boolean).join("\n");

    const aiRes = await fetch(`${aiSettings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiSettings.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://id-preview--4485e6f5-86ea-4999-acd7-7209fb13e21d.lovable.app",
        "X-Title": "Personal Firecrawl MCP",
      },
      body: JSON.stringify({
        model: aiSettings.model,
        messages: [
          { role: "system", content: synthesisInstructions },
          { role: "user", content: `Research prompt: ${prompt}\n\n---SOURCE EVIDENCE (${usableSources.length} articles)---\n\n${evidenceText}` },
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
    const groundedness = usableSources.length >= 3 ? "high" : usableSources.length >= 2 ? "medium" : "low";

    await svc.from("mcp_jobs").update({
      status: isWeakEvidence ? "completed" : "completed",
      output: {
        step: "completed",
        synthesis: answer || "No response from AI",
        groundedness,
        ...(isWeakEvidence ? { warning: `Only ${usableSources.length} of ${collectedCount} sources yielded usable article content. Synthesis may have limited grounding.` } : {}),
        evidenceMetrics: metrics,
        sources: sourceSummary,
        sourcesUsed: usableSources.map(s => s.finalUrl).filter((u): u is string => typeof u === "string"),
        scrapedCount: metrics.sourcesScrapedSuccessfully,
      },
    }).eq("id", jobId);
  } catch (err) {
    await svc.from("mcp_jobs").update({
      status: "failed",
      output: { error: err instanceof Error ? err.message : "Unknown error" },
    }).eq("id", jobId);
  }
}