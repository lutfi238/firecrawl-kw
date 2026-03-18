import { Hono } from "hono";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ========== Get AI provider settings from settings table ==========
async function getUserSettings(authHeader: string | null): Promise<Record<string, string>> {
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

    const { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", user.id);

    if (error || !data) return {};

    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value ?? "";
    return map;
  } catch {
    return {};
  }
}

function getAiSettingsFromMap(map: Record<string, string>): { baseUrl: string; apiKey: string; model: string } | null {
  if (!map.ai_api_key) return null;
  return {
    baseUrl: map.ai_base_url || "https://api.openai.com/v1",
    apiKey: map.ai_api_key,
    model: map.ai_model || "gpt-4o-mini",
  };
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getUserIdFromAuth(authHeader: string | null): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key || !authHeader) return Promise.resolve(null);
  const sb = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return sb.auth.getUser().then(({ data }) => data.user?.id ?? null).catch(() => null);
}

// ========== HTML → Markdown ==========
function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");
  md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, "![$1]()");

  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

// ========== URL helpers ==========
function sameOrigin(base: string, url: string): boolean {
  try {
    return new URL(base).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href="([^"]+)"/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const resolved = resolveUrl(baseUrl, m[1]);
    if (resolved && sameOrigin(baseUrl, resolved) && !resolved.includes("#")) {
      links.push(resolved.split("?")[0]);
    }
  }
  return [...new Set(links)];
}

// ========== Scrape helper ==========
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

// ========== URL redirect detection & resolution ==========
function isGoogleNewsRssWrapper(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "news.google.com" && u.pathname.includes("/rss/articles/");
  } catch {
    return false;
  }
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

// Domains that are never valid article targets
const REJECTED_HOSTS = [
  "news.google.com",
  "google.com",
  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "gstatic.com",
  "googleapis.com",
  "ggpht.com",
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "cloudfront.net",
  "cdn.ampproject.org",
  "amp.dev",
];

// File extensions that indicate media/assets, not articles
const REJECTED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".webm",
  ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot",
  ".css", ".js", ".json", ".xml",
];

function isValidArticleUrl(candidate: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(candidate);

    // Reject non-http(s)
    if (!parsed.protocol.startsWith("http")) {
      return { valid: false, reason: "non-http protocol" };
    }

    // Reject known CDN/asset/Google hosts
    const host = parsed.hostname.toLowerCase();
    for (const rejected of REJECTED_HOSTS) {
      if (host === rejected || host.endsWith("." + rejected)) {
        return { valid: false, reason: `rejected host: ${host}` };
      }
    }

    // Reject media/asset file extensions
    const pathLower = parsed.pathname.toLowerCase();
    for (const ext of REJECTED_EXTENSIONS) {
      if (pathLower.endsWith(ext)) {
        return { valid: false, reason: `asset extension: ${ext}` };
      }
    }

    // Reject very short paths that are likely homepages (e.g. just "/")
    if (parsed.pathname.length <= 1 && !parsed.search) {
      return { valid: false, reason: "homepage/root URL" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid URL" };
  }
}

function normalizeResolvedUrl(candidate: string): string | null {
  const check = isValidArticleUrl(candidate);
  if (!check.valid) {
    console.log("[gnews-resolve] Rejected candidate:", candidate.slice(0, 80), "—", check.reason);
    return null;
  }
  return new URL(candidate).href;
}

function decodeGoogleNewsToken(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/https?:\/\/[^\s"'\x00-\x1F<>\\]+/i);
    if (!match) return null;
    return normalizeResolvedUrl(match[0]);
  } catch {
    return null;
  }
}

function decodeEscapedUrl(value: string): string {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\\//g, "/");
}

async function resolveGoogleNewsRssUrl(url: string, rawDesc?: string): Promise<{ finalUrl?: string; resolveStatus: "resolved" | "unresolved_wrapper" | "failed"; error?: string; method?: string }> {
  try {
    // Strategy 1: Extract publisher URL from RSS <description> HTML
    // Google News RSS descriptions contain: <a href="https://real-publisher.com/article">Title</a>
    if (rawDesc) {
      console.log("[gnews-resolve] rawDesc present, length:", rawDesc.length);
      // Decode HTML entities first
      const decoded = rawDesc
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      // Extract href from anchor tags
      const hrefMatches = [...decoded.matchAll(/href="(https?:\/\/[^"]+)"/gi)];
      for (const hm of hrefMatches) {
        const candidate = normalizeResolvedUrl(hm[1]);
        if (candidate) {
          console.log("[gnews-resolve] Found publisher URL from description href:", candidate);
          return { finalUrl: candidate, resolveStatus: "resolved", method: "desc_href" };
        }
      }
      // Also try bare URLs in description text
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

    // Strategy 2: Try to decode the base64 token from the URL path
    const parsed = new URL(url);
    const token = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const decodedCandidate = decodeGoogleNewsToken(token);
    if (decodedCandidate) {
      console.log("[gnews-resolve] Decoded publisher URL from token:", decodedCandidate);
      return { finalUrl: decodedCandidate, resolveStatus: "resolved", method: "token_decode" };
    }
    console.log("[gnews-resolve] Token decode failed for:", token.slice(0, 30) + "...");

    // Strategy 3: HTTP fetch the Google News page and extract redirect/canonical
    console.log("[gnews-resolve] Trying HTTP fetch fallback");
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(10000),
    });

    // Check if the redirect itself resolved to a non-Google domain
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

// ========== Article content quality heuristic ==========
// Checks if scraped markdown looks like actual article body vs boilerplate/nav/login page
function isUsableArticleContent(markdown: string): boolean {
  if (markdown.length < 300) return false;

  // Count paragraphs (sequences of 50+ chars separated by newlines)
  const paragraphs = markdown.split(/\n\n+/).filter(p => p.trim().length > 50);
  if (paragraphs.length < 2) return false;

  // Avg sentence length heuristic: real articles have longer average text blocks
  const totalTextLength = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const avgParagraphLength = totalTextLength / paragraphs.length;
  if (avgParagraphLength < 40) return false;

  // Check for boilerplate signals
  const lower = markdown.toLowerCase();
  const boilerplateSignals = [
    "sign in", "log in", "subscribe now", "cookie policy",
    "accept cookies", "privacy policy", "terms of service",
  ];
  const boilerplateHits = boilerplateSignals.filter(s => lower.includes(s)).length;
  // If more than half the content is boilerplate indicators, reject
  if (boilerplateHits >= 3 && markdown.length < 1000) return false;

  return true;
}

// ========== Source acquisition types ==========
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

const MIN_USABLE_CONTENT_LENGTH = 300;

// ========== Search result with acquisition metadata ==========
interface SearchResult {
  title: string;
  url: string;
  sourceUrl: string;
  snippet: string;
  rawDesc: string;
  acquisitionType: AcquisitionType;
  searchSource: string; // which search engine found this
}

// ========== DuckDuckGo HTML search — returns direct publisher URLs ==========
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
    // DuckDuckGo HTML results have class="result__a" links and result__snippet
    const resultBlocks = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetBlocks = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];

    for (let i = 0; i < resultBlocks.length && results.length < maxResults; i++) {
      let rawHref = resultBlocks[i][1];
      const rawTitle = resultBlocks[i][2].replace(/<[^>]+>/g, "").trim();

      // DDG wraps URLs through a redirect — extract the real URL from uddg param
      if (rawHref.includes("uddg=")) {
        const match = rawHref.match(/uddg=([^&]+)/);
        if (match) rawHref = decodeURIComponent(match[1]);
      }

      // Validate it's a real article URL
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

// ========== Google News RSS — discovery only, may return wrappers ==========
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
      const linkMatch = item.match(/<link\s*\/?>\s*<!\[CDATA\[(.*?)\]\]>|<link>(.*?)<\/link>|<link\s*\/?>([^<\s]+)/i);
      const guidMatch = item.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
      const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
      const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (linkMatch?.[1] || linkMatch?.[2] || linkMatch?.[3] || guidMatch?.[1] || "").trim();
      if (title && rawLink) {
        rawItems.push({ title, rawLink, rawDesc: descMatch?.[1] || descMatch?.[2] || "" });
      }
    }

    // Resolve and classify
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
        // Direct link from RSS (rare but possible)
        results.push({
          title, url: rawLink, sourceUrl: rawLink,
          snippet: "", rawDesc,
          acquisitionType: "direct_article",
          searchSource: "google_news_rss",
        });
      }
    }

    // Build snippets for resolved results
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

// ========== Bing News RSS ==========
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

// ========== Combined Web Search — prioritizes direct publisher URLs ==========
async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  console.log("[search] Starting multi-source search for:", query, "max:", maxResults);

  // Run all search sources in parallel
  const [ddgResults, bingResults, gnewsResults] = await Promise.all([
    searchDuckDuckGo(query, maxResults),
    searchBingNewsRss(query, maxResults),
    searchGoogleNewsRss(query, maxResults),
  ]);

  // Priority order: direct articles first, then resolved, then unresolved wrappers last
  const allResults: SearchResult[] = [];

  // 1. Direct articles from DuckDuckGo (highest priority — real publisher URLs)
  for (const r of ddgResults) allResults.push(r);
  // 2. Direct articles from Bing
  for (const r of bingResults) allResults.push(r);
  // 3. Resolved articles from Google News
  for (const r of gnewsResults.filter(r => r.acquisitionType === "resolved_article")) allResults.push(r);
  // 4. Direct articles from Google News (rare)
  for (const r of gnewsResults.filter(r => r.acquisitionType === "direct_article")) allResults.push(r);
  // 5. Unresolved wrappers last (will be skipped in scrape pipeline)
  for (const r of gnewsResults.filter(r => r.acquisitionType === "unresolved_wrapper")) allResults.push(r);

  // Deduplicate by final URL domain+path
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

// ========== Background crawl processor ==========
async function processCrawlJob(jobId: string, args: Record<string, unknown>) {
  const svc = getServiceClient();
  try {
    await svc.from("mcp_jobs").update({ status: "processing" }).eq("id", jobId);

    const visited = new Set<string>();
    const queue: string[] = [args.url as string];
    const results: Array<{ url: string; title?: string; markdown?: string }> = [];
    const limit = (args.maxPages as number) || 10;

    while (queue.length > 0 && visited.size < limit) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      try {
        const res = await fetch(current, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" }, redirect: "follow" });
        if (!res.ok) continue;
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : current;
        const entry: { url: string; title?: string; markdown?: string } = { url: current, title };
        if (args.extractContent) entry.markdown = htmlToMarkdown(html);
        results.push(entry);
        for (const link of extractLinks(html, current)) {
          if (!visited.has(link)) queue.push(link);
        }
      } catch { /* skip */ }

      // Update progress periodically
      if (visited.size % 3 === 0) {
        await svc.from("mcp_jobs").update({
          output: { progress: `${visited.size}/${limit}`, partial: results.length },
        }).eq("id", jobId);
      }
    }

    await svc.from("mcp_jobs").update({
      status: "completed",
      output: { pages: results, totalCrawled: results.length },
    }).eq("id", jobId);
  } catch (err) {
    await svc.from("mcp_jobs").update({
      status: "failed",
      output: { error: err instanceof Error ? err.message : "Unknown error" },
    }).eq("id", jobId);
  }
}

// ========== Background batch scrape processor ==========
async function processBatchScrapeJob(jobId: string, args: Record<string, unknown>) {
  const svc = getServiceClient();
  try {
    await svc.from("mcp_jobs").update({ status: "processing" }).eq("id", jobId);

    const urlList = ((args.urls as string) || "").split(",").map((u: string) => u.trim()).filter(Boolean);
    const results: Array<{ url: string; title: string; markdown: string; error?: string }> = [];

    for (const url of urlList) {
      try {
        const { markdown, title } = await scrapeUrl(url);
        results.push({ url, title, markdown: markdown.slice(0, 4000) });
      } catch (e) {
        results.push({ url, title: "Error", markdown: "", error: e instanceof Error ? e.message : "unknown" });
      }

      // Update progress
      await svc.from("mcp_jobs").update({
        output: { progress: `${results.length}/${urlList.length}`, partial: results.length },
      }).eq("id", jobId);
    }

    await svc.from("mcp_jobs").update({
      status: "completed",
      output: { results, totalScraped: results.filter(r => !r.error).length },
    }).eq("id", jobId);
  } catch (err) {
    await svc.from("mcp_jobs").update({
      status: "failed",
      output: { error: err instanceof Error ? err.message : "Unknown error" },
    }).eq("id", jobId);
  }
}

// ========== Background agent processor ==========
async function processAgentJob(jobId: string, args: Record<string, unknown>, aiSettings: { baseUrl: string; apiKey: string; model: string }) {
  const svc = getServiceClient();

  try {
    await svc.from("mcp_jobs").update({ status: "processing", output: { step: "searching" } }).eq("id", jobId);

    const prompt = args.prompt as string;
    const rawUrls = args.urls;
    let focusUrls: string[] = [];
    if (Array.isArray(rawUrls)) {
      focusUrls = rawUrls.filter(Boolean);
    } else if (typeof rawUrls === "string" && rawUrls.trim()) {
      focusUrls = rawUrls.split(",").map((u: string) => u.trim()).filter(Boolean);
    }
    const schema = args.schema as string | undefined;
    const maxSteps = (args.maxSteps as number) || 5;

    // Step 1: Classify and validate user-provided focus URLs
    let discoveredUrls: SearchResult[] = [];
    for (const u of focusUrls) {
      const check = isValidArticleUrl(u);
      if (!check.valid) {
        console.log("[agent] Rejecting user URL:", u.slice(0, 80), check.reason);
        continue;
      }
      if (isGoogleNewsRssWrapper(u)) {
        // Attempt resolution for Google News wrappers
        const resolved = await resolveGoogleNewsRssUrl(u);
        if (resolved.finalUrl && resolved.resolveStatus === "resolved") {
          discoveredUrls.push({ title: "", url: resolved.finalUrl, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "resolved_article", searchSource: "user_provided" });
        } else {
          discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "unresolved_wrapper", searchSource: "user_provided" });
        }
      } else if (isRedirectUrl(u)) {
        const resolved = await resolveRedirect(u);
        const finalCheck = isValidArticleUrl(resolved.finalUrl);
        if (finalCheck.valid) {
          discoveredUrls.push({ title: "", url: resolved.finalUrl, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: resolved.resolved ? "resolved_article" : "direct_article", searchSource: "user_provided" });
        } else {
          console.log("[agent] Resolved user URL rejected:", resolved.finalUrl.slice(0, 80), finalCheck.reason);
        }
      } else {
        discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "", rawDesc: "", acquisitionType: "direct_article", searchSource: "user_provided" });
      }
    }
    console.log("[agent] Focus URLs:", focusUrls.length, "accepted:", discoveredUrls.length);

    if (discoveredUrls.length < maxSteps) {
      console.log("[agent] Searching web for:", prompt);
      const searchResults = await searchWeb(prompt, maxSteps - discoveredUrls.length);
      console.log("[agent] Search returned", searchResults.length, "results");
      for (const r of searchResults) discoveredUrls.push(r);
    }

    // No results at all
    if (discoveredUrls.length === 0) {
      console.log("[agent] No URLs discovered — returning low-evidence result");
      const emptyMetrics: EvidenceMetrics = { sourcesCollected: 0, sourcesResolved: 0, sourcesUnresolvedWrapper: 0, sourcesScrapedSuccessfully: 0, sourcesUsableForSynthesis: 0, sourcesFailed: 0, sourcesEmpty: 0, sourcesBoilerplate: 0 };
      await svc.from("mcp_jobs").update({
        status: "completed",
        output: { step: "completed", synthesis: null, groundedness: "none", warning: "Web search returned no relevant URLs.", evidenceMetrics: emptyMetrics, sources: [], scrapedCount: 0 },
      }).eq("id", jobId);
      return;
    }

    discoveredUrls = discoveredUrls.slice(0, maxSteps);
    const collectedCount = discoveredUrls.length;

    // Check if ALL results are unresolved wrappers — return early
    const scrapeable = discoveredUrls.filter(r => r.acquisitionType !== "unresolved_wrapper");
    if (scrapeable.length === 0) {
      console.log("[agent] All", collectedCount, "results are unresolved wrappers — returning low-evidence");
      const wrapperMetrics: EvidenceMetrics = { sourcesCollected: collectedCount, sourcesResolved: 0, sourcesUnresolvedWrapper: collectedCount, sourcesScrapedSuccessfully: 0, sourcesUsableForSynthesis: 0, sourcesFailed: 0, sourcesEmpty: 0, sourcesBoilerplate: 0 };
      const wrapperSummary = discoveredUrls.map(r => ({ sourceUrl: r.sourceUrl, finalUrl: undefined, title: r.title, publisher: extractDomain(r.sourceUrl), contentLength: 0, acquisitionType: r.acquisitionType, resolveStatus: "unresolved_wrapper" as const, scrapeStatus: "unresolved_wrapper" as const }));
      await svc.from("mcp_jobs").update({
        status: "completed",
        output: { step: "completed", synthesis: null, groundedness: "none", warning: "All discovered sources were Google News wrappers that could not be resolved to publisher URLs.", evidenceMetrics: wrapperMetrics, sources: wrapperSummary, scrapedCount: 0 },
      }).eq("id", jobId);
      return;
    }

    // Step 2: Scrape — only direct_article and resolved_article, skip unresolved wrappers
    await svc.from("mcp_jobs").update({ output: { step: "scraping", sourcesCollected: collectedCount } }).eq("id", jobId);

    const sources: NormalizedSource[] = [];
    for (const item of discoveredUrls) {
      // Skip unresolved wrappers entirely — do not scrape
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

      // For direct articles, handle remaining redirects (t.co, bit.ly etc)
      if (isRedirectUrl(item.url) && !isGoogleNewsRssWrapper(item.url)) {
        const resolved = await resolveRedirect(item.url);
        finalUrl = resolved.finalUrl;
        resolveStatus = resolved.resolved ? "resolved" : "unchanged";
      }

      // Scrape
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

      // Progress
      await svc.from("mcp_jobs").update({
        output: { step: "scraping", sourcesCollected: collectedCount, scrapedCount: sources.filter(s => s.scrapeStatus === "success").length, totalSources: collectedCount },
      }).eq("id", jobId);
    }

    // Compute evidence metrics
    const metrics: EvidenceMetrics = {
      sourcesCollected: collectedCount,
      sourcesResolved: sources.filter(s => s.resolveStatus === "resolved").length,
      sourcesUnresolvedWrapper: sources.filter(s => s.acquisitionType === "unresolved_wrapper").length,
      sourcesScrapedSuccessfully: sources.filter(s => s.scrapeStatus === "success").length,
      sourcesUsableForSynthesis: sources.filter(s => s.scrapeStatus === "success").length,
      sourcesFailed: sources.filter(s => s.scrapeStatus === "failed").length,
      sourcesEmpty: sources.filter(s => s.scrapeStatus === "empty").length,
      sourcesBoilerplate: sources.filter(s => s.scrapeStatus === "boilerplate").length,
    };

    console.log("[agent] Evidence metrics:", JSON.stringify(metrics));

    // Build source summary for status display
    const sourceSummary = sources.map(s => ({
      sourceUrl: s.sourceUrl, finalUrl: s.finalUrl,
      title: s.title, publisher: s.publisher,
      contentLength: s.contentLength, acquisitionType: s.acquisitionType,
      resolveStatus: s.resolveStatus, scrapeStatus: s.scrapeStatus, error: s.error,
    }));

    // Step 3: Synthesis quality gate
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

    // Build evidence text from usable sources only
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
async function createJob(
  authHeader: string | null,
  type: string,
  input: Record<string, unknown>,
): Promise<{ jobId: string; error?: string }> {
  const userId = await getUserIdFromAuth(authHeader);
  if (!userId) return { jobId: "", error: "Not authenticated" };

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("mcp_jobs")
    .insert({ user_id: userId, type, status: "pending", input })
    .select("id")
    .single();

  if (error || !data) return { jobId: "", error: error?.message || "Failed to create job" };
  return { jobId: data.id };
}

// ========== Check job status helper ==========
async function checkJobStatus(authHeader: string | null, jobId: string): Promise<Record<string, unknown>> {
  const userId = await getUserIdFromAuth(authHeader);
  if (!userId) return { error: "Not authenticated" };

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb
    .from("mcp_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return { error: "Job not found" };
  return {
    jobId: data.id,
    type: data.type,
    status: data.status,
    ...(data.output as Record<string, unknown> || {}),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// ========== Chat orchestration: intent classification + tool-first evidence ==========

type ChatIntent =
  | "casual"
  | "factual"
  | "ranking"
  | "url_scrape"
  | "multi_url"
  | "crawl_request"
  | "extract_request"
  | "deep_research"
  | "job_status";

function classifyChatIntent(message: string): ChatIntent {
  const msg = message.trim();
  const lower = msg.toLowerCase();

  // Job status: UUID pattern
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(msg)) {
    return "job_status";
  }

  // Multiple URLs
  const urls = msg.match(/https?:\/\/[^\s,]+/g);
  if (urls && urls.length > 1) return "multi_url";

  // Single URL
  if (urls && urls.length === 1 && msg.split(/\s+/).length <= 10) return "url_scrape";

  // Crawl/map requests
  if (/\b(crawl|map|sitemap|all pages|spider)\b/i.test(lower)) return "crawl_request";

  // Extract requests
  if (/\b(extract)\b/i.test(lower) && urls && urls.length >= 1) return "extract_request";

  // Deep research
  if (/\b(research|in-depth|comprehensive|analyze|deep dive|investigate)\b/i.test(lower) && lower.length > 40) return "deep_research";

  // Ranking / list / comparison queries
  if (
    /\btop\s*\d+/i.test(lower) ||
    /\bbest\b/i.test(lower) ||
    /\branking\b/i.test(lower) ||
    /\branked\b/i.test(lower) ||
    /\bcompare\b/i.test(lower) ||
    /\bcomparison\b/i.test(lower) ||
    /\balternatives?\b/i.test(lower) ||
    /\bvs\.?\b/i.test(lower) ||
    /\bleaderboard\b/i.test(lower) ||
    /\bworst\b/i.test(lower)
  ) {
    return "ranking";
  }

  // Factual / current-events questions
  if (
    /\b(what|who|when|where|why|how|which|is|are|was|were|did|does|do|can|could|will|should)\b/i.test(lower) ||
    /\b(latest|current|recent|new|2024|2025|2026|today|yesterday|this week|this month)\b/i.test(lower) ||
    /\?$/.test(msg.trim())
  ) {
    return "factual";
  }

  // Casual: greetings, short messages, non-questions
  if (lower.length < 30 || /^(hi|hello|hey|thanks|thank you|ok|sure|cool|great|bye|good morning|good night)/i.test(lower)) {
    return "casual";
  }

  // Default: treat as factual to be safe
  return "factual";
}

function chatSearchEvidenceHasDepth(evidence: string): boolean {
  const stripped = evidence
    .split("\n")
    .filter((l: string) => !l.match(/^\s*"?(title|url|sourceUrl|snippet|rawDesc|acquisitionType|searchSource)"?\s*:/) && !l.match(/^\s*[\[\]{}],?\s*$/))
    .join(" ")
    .trim();
  return stripped.length > 2000;
}

async function callAI(
  aiSettings: { baseUrl: string; apiKey: string; model: string },
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096,
): Promise<string> {
  const res = await fetch(`${aiSettings.baseUrl}/chat/completions`, {
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
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Streaming version of callAI — returns a ReadableStream of SSE chunks
function callAIStream(
  aiSettings: { baseUrl: string; apiKey: string; model: string },
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(`${aiSettings.baseUrl}/chat/completions`, {
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
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            max_tokens: maxTokens,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AI API error ${res.status}: ${errText.slice(0, 300)}` })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === "data: [DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
                }
              } catch {
                // skip malformed
              }
            }
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Stream error" })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

function isHeavyChatIntent(intent: ChatIntent): boolean {
  return intent === "ranking" || intent === "deep_research";
}

async function handleChatWithOrchestration(
  args: Record<string, unknown>,
  aiSettings: { baseUrl: string; apiKey: string; model: string },
  authHeader: string | null,
): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
  const message = (args.message as string) || "";
  const history = (args.history as Array<{ role: string; content: string }>) || [];
  const mode = (args.mode as string) || "orchestrate";

  // === SYNTHESIS BYPASS MODE ===
  // When mode is "synthesis", skip all orchestration and call the model directly.
  // Used by the AI Chat frontend for final evidence synthesis after tools have already run.
  if (mode === "synthesis") {
    console.log("[chat] Synthesis bypass mode — direct LLM call, no orchestration");
    const systemPrompt = history.find(m => m.role === "system")?.content || "You are a helpful assistant.";
    const nonSystemHistory = history.filter(m => m.role !== "system");
    const answer = await callAI(aiSettings, systemPrompt, buildHistoryContext(nonSystemHistory, message), 4096);
    return { content: [{ type: "text", text: answer }] };
  }

  const intent = classifyChatIntent(message);
  console.log("[chat-orchestrator] Message:", message.slice(0, 100), "| Intent:", intent, "| Mode:", isHeavyChatIntent(intent) ? "async" : "sync");

  const steps: string[] = [];
  const addStep = (s: string) => { steps.push(s); console.log("[chat-orchestrator]", s); };

  try {
    // ========== CASUAL ==========
    if (intent === "casual") {
      addStep("Intent: casual — direct LLM response");
      const answer = await callAI(
        aiSettings,
        "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully.",
        buildHistoryContext(history, message),
      );
      return { content: [{ type: "text", text: answer }] };
    }

    // ========== JOB STATUS ==========
    if (intent === "job_status") {
      const jobIdMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (jobIdMatch) {
        addStep("Intent: job_status — checking job " + jobIdMatch[0]);
        const status = await checkJobStatus(authHeader, jobIdMatch[0]);
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      }
    }

    // ========== URL SCRAPE ==========
    if (intent === "url_scrape") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: url_scrape — scraping " + urlMatch[0]);
        try {
          const { markdown, title } = await scrapeUrl(urlMatch[0]);
          return { content: [{ type: "text", text: `# ${title}\n\n${markdown}` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Failed to scrape ${urlMatch[0]}: ${e instanceof Error ? e.message : "unknown"}` }], isError: true };
        }
      }
    }

    // ========== MULTI URL ==========
    if (intent === "multi_url") {
      const urls = message.match(/https?:\/\/[^\s,]+/g) || [];
      addStep("Intent: multi_url — batch scraping " + urls.length + " URLs");
      const job = await createJob(authHeader, "batch_scrape", { urls: urls.join(", ") });
      if (job.error) {
        return { content: [{ type: "text", text: `Error creating batch job: ${job.error}` }], isError: true };
      }
      EdgeRuntime.waitUntil(processBatchScrapeJob(job.jobId, { urls: urls.join(", ") }));
      return { content: [{ type: "text", text: `Batch scrape started for ${urls.length} URLs.\n\nJob ID: ${job.jobId}\n\nUse \`check_batch_status\` or send the job ID to check results.` }] };
    }

    // ========== CRAWL REQUEST ==========
    if (intent === "crawl_request") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: crawl — starting crawl for " + urlMatch[0]);
        const job = await createJob(authHeader, "crawl", { url: urlMatch[0], maxPages: 10, extractContent: true });
        if (job.error) {
          return { content: [{ type: "text", text: `Error creating crawl job: ${job.error}` }], isError: true };
        }
        EdgeRuntime.waitUntil(processCrawlJob(job.jobId, { url: urlMatch[0], maxPages: 10, extractContent: true }));
        return { content: [{ type: "text", text: `Crawl started for ${urlMatch[0]}.\n\nJob ID: ${job.jobId}\n\nUse \`check_crawl_status\` or send the job ID to check results.` }] };
      }
    }

    // ========== EXTRACT REQUEST ==========
    if (intent === "extract_request") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: extract — extracting from " + urlMatch[0]);
        try {
          const { markdown } = await scrapeUrl(urlMatch[0]);
          const truncated = markdown.slice(0, 12000);
          const answer = await callAI(
            aiSettings,
            "Extract the requested data from the web page content. Return structured information.",
            `User request: ${message}\n\n---PAGE CONTENT---\n${truncated}`,
          );
          return { content: [{ type: "text", text: answer }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Failed to extract from ${urlMatch[0]}: ${e instanceof Error ? e.message : "unknown"}` }], isError: true };
        }
      }
    }

    // ========== HEAVY: RANKING / DEEP RESEARCH → ASYNC AGENT JOB ==========
    if (isHeavyChatIntent(intent)) {
      addStep(`Intent: ${intent} — delegating to async agent job`);
      const job = await createJob(authHeader, "agent", { prompt: message, maxSteps: 5 });
      if (job.error) {
        return { content: [{ type: "text", text: `Error creating research job: ${job.error}` }], isError: true };
      }
      EdgeRuntime.waitUntil(processAgentJob(job.jobId, { prompt: message, maxSteps: 5 }, aiSettings));

      const modeLabel = intent === "ranking" ? "ranking/comparison research" : "deep research";
      return {
        content: [{
          type: "text",
          text: [
            `🔬 **${modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)} started** (async)`,
            "",
            `This query requires multi-source evidence collection and synthesis, which would exceed the sync timeout. It has been delegated to the async research agent.`,
            "",
            `**Job ID:** \`${job.jobId}\``,
            "",
            `Check progress with the \`agent_status\` tool using this job ID, or paste the job ID in chat.`,
          ].join("\n"),
        }],
      };
    }

    // ========== FACTUAL — lightweight sync: search + concise synthesis ==========
    addStep("Intent: factual — lightweight sync search + synthesis");

    const searchResults = await searchWeb(message, 5);
    const searchEvidence = JSON.stringify(searchResults.map(r => ({
      title: r.title, url: r.url, snippet: r.snippet,
    })), null, 2);
    addStep(`Search returned ${searchResults.length} results`);

    // For factual sync: optionally scrape ONE top result if snippets seem thin
    let combinedEvidence = searchEvidence;
    if (!chatSearchEvidenceHasDepth(searchEvidence) && searchResults.length > 0) {
      const top = searchResults.find(r => r.acquisitionType !== "unresolved_wrapper");
      if (top) {
        try {
          addStep(`Snippets thin — scraping top result: ${top.url.slice(0, 60)}`);
          const { markdown, title } = await scrapeUrl(top.url);
          if (isUsableArticleContent(markdown)) {
            combinedEvidence = `# ${title}\nSource: ${top.url}\n\n${markdown.slice(0, 4000)}\n\n---\n\nAdditional search results:\n${searchEvidence}`;
            addStep("Scraped 1 supporting article");
          }
        } catch {
          addStep("Single scrape failed — using snippets only");
        }
      }
    }

    // Synthesis
    addStep("Synthesizing from evidence");
    const synthesisRules = [
      "You are a research assistant that answers ONLY from the provided evidence.",
      "RULES:",
      "1. Base your answer ONLY on the evidence below. Do NOT use background knowledge.",
      "2. If evidence is insufficient, say so. Do not invent.",
      "3. Cite sources by title or URL.",
      "4. Be concise — this is a quick factual answer, not a research report.",
      "5. Include relevant source URLs at the end.",
    ];

    const answer = await callAI(
      aiSettings,
      synthesisRules.join("\n"),
      `Question: ${message}\n\n---EVIDENCE---\n\n${combinedEvidence}`,
      2048,
    );

    const meta = `\n\n---\n*Orchestration: ${steps.join(" → ")}*`;
    return { content: [{ type: "text", text: answer + meta }] };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown orchestration error";
    console.error("[chat-orchestrator] Error:", errMsg);
    return { content: [{ type: "text", text: `Error during chat orchestration: ${errMsg}` }], isError: true };
  }
}

function buildHistoryContext(history: Array<{ role: string; content: string }>, current: string): string {
  if (history.length === 0) return current;
  const ctx = history.map(m => `${m.role}: ${m.content}`).join("\n");
  return `Previous conversation:\n${ctx}\n\nCurrent message: ${current}`;
}

// ========== Hono App ==========
const app = new Hono();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-github-token, x-mcp-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

// CORS preflight
app.options("/*", (c) => {
  return new Response(null, { headers: corsHeaders });
});

// ========== API Key middleware ==========
function checkMcpSecret(c: any): Response | null {
  const secret = Deno.env.get("MCP_SECRET");
  if (!secret) return null;
  const provided = c.req.header("x-mcp-secret");
  if (provided !== secret) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: invalid or missing X-MCP-Secret header" } },
      401,
      corsHeaders
    );
  }
  return null;
}

// Health check GET handler
app.get("/*", (c) => {
  return c.json(
    { status: "ok", server: "personal-firecrawl", version: "2.0.0", tools: 15 },
    200,
    corsHeaders
  );
});

// MCP POST handler
app.post("/*", async (c) => {
  const denied = checkMcpSecret(c);
  if (denied) return denied;

  const authHeader = c.req.header("authorization") || null;
  const githubToken = c.req.header("x-github-token") || null;

  try {
    const body = await c.req.json();
    const { jsonrpc, id, method, params } = body;

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "personal-firecrawl", version: "2.0.0" },
        },
      }, 200, corsHeaders);
    }

    if (method === "tools/list") {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      const extractDesc = aiSettings
        ? `Scrape URL and use AI (${aiSettings.model}) to extract structured data`
        : "Scrape URL and use AI to extract structured data (not configured)";
      const rendererEnabled = userSettings.renderer_enabled === "true";
      const scrapeJsDesc = rendererEnabled
        ? "Scrape a JS-rendered page via Render renderer"
        : "Scrape a JS-rendered page (disabled - configure Render renderer in Settings)";
      const screenshotDesc = rendererEnabled
        ? "Take a screenshot via Render renderer"
        : "Take a screenshot (disabled - configure Render renderer in Settings)";
      const agentDesc = aiSettings
        ? `Autonomous AI research agent — searches, scrapes, and synthesizes information using ${aiSettings.model}`
        : "Autonomous AI research agent (not configured — set AI provider in Settings)";

      const toolDefs = [
        { name: "search", description: "Search the web using DuckDuckGo", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
        { name: "scrape", description: "Fetch a URL and convert HTML to Markdown", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
        { name: "scrape_js", description: scrapeJsDesc, inputSchema: { type: "object", properties: { url: { type: "string" }, waitFor: { type: "number" } }, required: ["url"] } },
        { name: "crawl", description: "Async BFS crawl a website — returns jobId for polling", inputSchema: { type: "object", properties: { url: { type: "string" }, maxPages: { type: "number" }, extractContent: { type: "boolean" } }, required: ["url"] } },
        { name: "map", description: "Fast URL-only crawl to map all links on a domain", inputSchema: { type: "object", properties: { url: { type: "string" }, maxPages: { type: "number" } }, required: ["url"] } },
        { name: "extract", description: extractDesc, inputSchema: { type: "object", properties: { url: { type: "string" }, prompt: { type: "string" }, schema: { type: "string" } }, required: ["url", "prompt"] } },
        { name: "screenshot", description: screenshotDesc, inputSchema: { type: "object", properties: { url: { type: "string" }, width: { type: "number" }, height: { type: "number" } }, required: ["url"] } },
        { name: "search_and_scrape", description: "Search then scrape top results", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
        { name: "html_to_markdown", description: "Convert HTML string to Markdown", inputSchema: { type: "object", properties: { html: { type: "string" } }, required: ["html"] } },
        { name: "batch_scrape", description: "Async scrape multiple URLs — returns jobId for polling", inputSchema: { type: "object", properties: { urls: { type: "string" } }, required: ["urls"] } },
        { name: "chat", description: "AI assistant with tools-first orchestration — searches, scrapes, and synthesizes evidence for factual/ranking queries; lightweight for casual chat. Pass mode:'synthesis' to bypass orchestration for direct LLM calls.", inputSchema: { type: "object", properties: { message: { type: "string" }, history: { type: "array" }, mode: { type: "string", enum: ["orchestrate", "synthesis"], description: "orchestrate (default): full intent routing. synthesis: bypass orchestration, direct LLM call." } }, required: ["message"] } },
        { name: "check_crawl_status", description: "Check status of an async crawl job", inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] } },
        { name: "check_batch_status", description: "Check status of an async batch scrape job", inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] } },
        { name: "agent", description: agentDesc, inputSchema: { type: "object", properties: { prompt: { type: "string" }, urls: { type: "array", items: { type: "string" } }, schema: { type: "string" }, maxSteps: { type: "number" } }, required: ["prompt"] } },
        { name: "agent_status", description: "Check status of an autonomous agent research job", inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] } },
      ];
      return c.json({ jsonrpc: "2.0", id, result: { tools: toolDefs } }, 200, corsHeaders);
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let result;

      // For renderer-dependent tools, check user settings
      if (name === "scrape_js" || name === "screenshot") {
        const userSettings = await getUserSettings(authHeader);
        if (userSettings.renderer_enabled !== "true") {
          result = { content: [{ type: "text", text: "Tool disabled. Configure Render renderer URL in Settings to enable JS rendering." }], isError: true };
          return c.json({ jsonrpc: "2.0", id, result }, 200, corsHeaders);
        }
      }

      switch (name) {
        case "search": {
          const results = await searchWeb(args.query, args.maxResults || 10);
          result = { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
          break;
        }
        case "scrape": {
          const { markdown, title } = await scrapeUrl(args.url);
          result = { content: [{ type: "text", text: `# ${title}\n\n${markdown}` }] };
          break;
        }
        case "scrape_js": {
          const userSettings = await getUserSettings(authHeader);
          const rendererUrl = userSettings.renderer_url;
          if (!rendererUrl) {
            result = { content: [{ type: "text", text: "Error: Renderer URL not configured in Settings." }], isError: true };
          } else {
            const secret = userSettings.renderer_secret || "";
            const res = await fetch(`${rendererUrl}/render`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Secret": secret },
              body: JSON.stringify({ url: args.url, waitFor: args.waitFor || 3000 }),
            });
            if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
            const { html } = await res.json();
            result = { content: [{ type: "text", text: htmlToMarkdown(html) }] };
          }
          break;
        }

        // ========== ASYNC CRAWL ==========
        case "crawl": {
          const job = await createJob(authHeader, "crawl", args);
          if (job.error) {
            result = { content: [{ type: "text", text: `Error creating crawl job: ${job.error}` }], isError: true };
          } else {
            // Fire and forget background processing
            EdgeRuntime.waitUntil(processCrawlJob(job.jobId, args));
            result = { content: [{ type: "text", text: JSON.stringify({ jobId: job.jobId, status: "pending", message: "Crawl started. Use check_crawl_status tool with this jobId to poll for results." }) }] };
          }
          break;
        }

        case "map": {
          const visited = new Set<string>();
          const queue: string[] = [args.url];
          const limit = args.maxPages || 50;
          while (queue.length > 0 && visited.size < limit) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);
            try {
              const res = await fetch(current, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" }, redirect: "follow" });
              if (!res.ok) continue;
              const html = await res.text();
              for (const link of extractLinks(html, current)) {
                if (!visited.has(link)) queue.push(link);
              }
            } catch { /* skip */ }
          }
          result = { content: [{ type: "text", text: JSON.stringify([...visited], null, 2) }] };
          break;
        }

        case "extract": {
          const uSettings = await getUserSettings(authHeader);
          const aiSettings = getAiSettingsFromMap(uSettings);
          if (!aiSettings) {
            result = { content: [{ type: "text", text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key." }], isError: true };
          } else {
            const { markdown } = await scrapeUrl(args.url);
            const truncated = markdown.slice(0, 12000);
            const systemPrompt = args.schema
              ? `Extract the requested data from the web page content. Return valid JSON matching this schema: ${args.schema}`
              : "Extract the requested data from the web page content. Return structured JSON.";
            const aiHeaders: Record<string, string> = {
              Authorization: `Bearer ${aiSettings.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://id-preview--4485e6f5-86ea-4999-acd7-7209fb13e21d.lovable.app",
              "X-Title": "Personal Firecrawl MCP",
            };
            const requestBody = { model: aiSettings.model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `${args.prompt}\n\n---PAGE CONTENT---\n${truncated}` }], max_tokens: 4096 };
            console.log("[extract] AI request:", aiSettings.baseUrl, aiSettings.model);
            const aiRes = await fetch(`${aiSettings.baseUrl}/chat/completions`, {
              method: "POST",
              headers: aiHeaders,
              body: JSON.stringify(requestBody),
            });
            const aiBody = await aiRes.text();
            console.log("[extract] AI response status:", aiRes.status, "body:", aiBody.slice(0, 500));
            if (!aiRes.ok) {
              let errorMsg = `AI API error ${aiRes.status}`;
              try {
                const errData = JSON.parse(aiBody);
                errorMsg += `: ${errData.error?.message || errData.message || aiBody.slice(0, 300)}`;
              } catch {
                errorMsg += `: ${aiBody.slice(0, 300)}`;
              }
              result = { content: [{ type: "text", text: errorMsg }], isError: true };
            } else {
              const aiData = JSON.parse(aiBody);
              console.log("[extract] AI parsed response keys:", Object.keys(aiData));
              const answer = aiData.choices?.[0]?.message?.content;
              if (!answer) {
                console.log("[extract] Full AI response:", JSON.stringify(aiData).slice(0, 1000));
                result = { content: [{ type: "text", text: `AI returned no content. Raw response: ${JSON.stringify(aiData).slice(0, 500)}` }], isError: true };
              } else {
                result = { content: [{ type: "text", text: answer }] };
              }
            }
          }
          break;
        }

        case "screenshot": {
          const sSettings = await getUserSettings(authHeader);
          const rendererUrl = sSettings.renderer_url;
          if (!rendererUrl) {
            result = { content: [{ type: "text", text: "Error: Renderer URL not configured in Settings." }], isError: true };
          } else {
            const secret = sSettings.renderer_secret || "";
            const res = await fetch(`${rendererUrl}/screenshot`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Secret": secret },
              body: JSON.stringify({ url: args.url, width: args.width || 1280, height: args.height || 720 }),
            });
            if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
            const { image } = await res.json();
            result = { content: [{ type: "image", data: image, mimeType: "image/png" }] };
          }
          break;
        }

        case "search_and_scrape": {
          const searchResults = await searchWeb(args.query, args.maxResults || 3);
          const scraped: string[] = [];
          for (const r of searchResults) {
            try {
              const { markdown, title } = await scrapeUrl(r.url);
              scraped.push(`# ${title}\nURL: ${r.url}\n\n${markdown.slice(0, 4000)}\n\n---`);
            } catch {
              scraped.push(`# ${r.title}\nURL: ${r.url}\nFailed to scrape.\n\n---`);
            }
          }
          result = { content: [{ type: "text", text: scraped.join("\n\n") }] };
          break;
        }

        case "html_to_markdown": {
          result = { content: [{ type: "text", text: htmlToMarkdown(args.html) }] };
          break;
        }

        // ========== ASYNC BATCH SCRAPE ==========
        case "batch_scrape": {
          const job = await createJob(authHeader, "batch_scrape", args);
          if (job.error) {
            result = { content: [{ type: "text", text: `Error creating batch job: ${job.error}` }], isError: true };
          } else {
            EdgeRuntime.waitUntil(processBatchScrapeJob(job.jobId, args));
            result = { content: [{ type: "text", text: JSON.stringify({ jobId: job.jobId, status: "pending", message: "Batch scrape started. Use check_batch_status tool with this jobId to poll for results." }) }] };
          }
          break;
        }

        // ========== POLLING TOOLS ==========
        case "check_crawl_status": {
          const status = await checkJobStatus(authHeader, args.jobId);
          result = { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
          break;
        }

        case "check_batch_status": {
          const status = await checkJobStatus(authHeader, args.jobId);
          result = { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
          break;
        }

        // ========== AGENT TOOL ==========
        case "agent": {
          const uSettings = await getUserSettings(authHeader);
          const aiSettings = getAiSettingsFromMap(uSettings);
          if (!aiSettings) {
            result = { content: [{ type: "text", text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key." }], isError: true };
          } else {
            const job = await createJob(authHeader, "agent", args);
            if (job.error) {
              result = { content: [{ type: "text", text: `Error creating agent job: ${job.error}` }], isError: true };
            } else {
              EdgeRuntime.waitUntil(processAgentJob(job.jobId, args, aiSettings));
              result = { content: [{ type: "text", text: JSON.stringify({ jobId: job.jobId, status: "pending", message: "Agent research started. Use agent_status tool with this jobId to poll for results." }) }] };
            }
          }
          break;
        }

        case "agent_status": {
          const status = await checkJobStatus(authHeader, args.jobId);
          result = { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
          break;
        }

        case "chat": {
          const cSettings = await getUserSettings(authHeader);
          const aiSettings = getAiSettingsFromMap(cSettings);
          if (!aiSettings) {
            result = { content: [{ type: "text", text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key." }], isError: true };
          } else if (args.stream === true) {
            // STREAMING MODE: return SSE stream directly
            const streamMode = (args.mode as string) || "orchestrate";
            
            if (streamMode === "synthesis") {
              // Direct streaming LLM call for synthesis
              const history = (args.history as Array<{ role: string; content: string }>) || [];
              const message = (args.message as string) || "";
              const systemPrompt = history.find(m => m.role === "system")?.content || "You are a helpful assistant.";
              const nonSystemHistory = history.filter(m => m.role !== "system");
              const stream = callAIStream(aiSettings, systemPrompt, buildHistoryContext(nonSystemHistory, message), 4096);
              return new Response(stream, {
                headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
              });
            }
            
            // For orchestrate mode with streaming: do orchestration sync, then stream final synthesis
            const message = (args.message as string) || "";
            const history = (args.history as Array<{ role: string; content: string }>) || [];
            const intent = classifyChatIntent(message);
            
            if (intent === "casual") {
              const stream = callAIStream(
                aiSettings,
                "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully.",
                buildHistoryContext(history, message),
              );
              return new Response(stream, {
                headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
              });
            }
            
            // For non-casual intents: fall back to non-streaming orchestration
            result = await handleChatWithOrchestration(args, aiSettings, authHeader);
          } else {
            result = await handleChatWithOrchestration(args, aiSettings, authHeader);
          }
          break;
        }

        default:
          return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } }, 200, corsHeaders);
      }

      return c.json({ jsonrpc: "2.0", id, result }, 200, corsHeaders);
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } }, 200, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("MCP error:", message);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }, 200, corsHeaders);
  }
});

// Declare EdgeRuntime for Deno/Supabase
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

Deno.serve(app.fetch);
