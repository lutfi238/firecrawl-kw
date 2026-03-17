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
function isRedirectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes("news.google.com") ||
      u.hostname.includes("google.com/rss") ||
      u.pathname.includes("/rss/articles/") ||
      u.hostname.includes("feedproxy.google.com") ||
      u.hostname.includes("t.co") ||
      u.hostname.includes("bit.ly") ||
      u.hostname.includes("ow.ly")
    );
  } catch {
    return false;
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
    return { finalUrl, resolved: finalUrl !== url };
  } catch (e) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
        signal: AbortSignal.timeout(8000),
      });
      const finalUrl = res.url || url;
      await res.body?.cancel();
      return { finalUrl, resolved: finalUrl !== url };
    } catch {
      return { finalUrl: url, resolved: false, error: e instanceof Error ? e.message : "resolve failed" };
    }
  }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ========== Source evidence types ==========
interface NormalizedSource {
  sourceUrl: string;
  finalUrl: string;
  title: string;
  publisher: string;
  excerpt: string;
  markdown: string;
  contentLength: number;
  resolveStatus: "resolved" | "unchanged" | "failed";
  scrapeStatus: "success" | "failed" | "empty";
  error?: string;
}

interface EvidenceMetrics {
  sourcesCollected: number;
  sourcesResolved: number;
  sourcesScrapedSuccessfully: number;
  sourcesUsableForSynthesis: number;
  failedSources: number;
  emptyContentSources: number;
}

const MIN_USABLE_CONTENT_LENGTH = 200;

// ========== Web Search (RSS-based) ==========
async function searchWeb(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encoded = encodeURIComponent(query);

  const sources = [
    `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`,
    `https://www.bing.com/news/search?q=${encoded}&format=rss`,
  ];

  for (const feedUrl of sources) {
    try {
      console.log("[search] Trying RSS source:", feedUrl);
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { console.log("[search] RSS returned", res.status); continue; }
      const xml = await res.text();
      console.log("[search] RSS XML length:", xml.length);

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

      if (rawItems.length === 0) continue;

      const items = await Promise.all(rawItems.map(async ({ title, rawLink, rawDesc }) => {
        let finalUrl = rawLink;
        if (isRedirectUrl(rawLink)) {
          const resolved = await resolveRedirect(rawLink);
          finalUrl = resolved.finalUrl;
        }

        let snippet = "";
        if (rawDesc) {
          const cleaned = rawDesc
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "").trim();
          const titleLower = title.toLowerCase();
          const cleanedLower = cleaned.toLowerCase();
          const isDifferent = !cleanedLower.includes(titleLower) && !titleLower.includes(cleanedLower);
          if (isDifferent && cleaned.length > 30) {
            snippet = cleaned.slice(0, 200);
          }
        }

        return { title, url: finalUrl, sourceUrl: rawLink, snippet };
      }));

      const seen = new Set<string>();
      const deduped = items.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });

      console.log("[search] RSS found", deduped.length, "results from", feedUrl);
      if (deduped.length > 0) return deduped;
    } catch (e) {
      console.log("[search] RSS failed:", feedUrl, e instanceof Error ? e.message : "unknown");
    }
  }

  console.log("[search] All RSS sources failed, returning empty");
  return [];
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
  const FALLBACK_SOURCES = [
    "https://techcrunch.com",
    "https://www.theverge.com",
    "https://arstechnica.com",
    "https://news.ycombinator.com",
  ];

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

    // Step 1: Search for relevant URLs
    let discoveredUrls: Array<{ title: string; url: string; sourceUrl: string; snippet: string }> = [];
    for (const u of focusUrls) {
      discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "" });
    }
    console.log("[agent] Focus URLs:", focusUrls);

    if (discoveredUrls.length < maxSteps) {
      console.log("[agent] Searching web for:", prompt);
      const searchResults = await searchWeb(prompt, maxSteps - discoveredUrls.length);
      console.log("[agent] Search returned", searchResults.length, "results");
      for (const r of searchResults) {
        discoveredUrls.push({ title: r.title, url: r.url, sourceUrl: (r as any).sourceUrl || r.url, snippet: r.snippet });
      }
    }

    if (discoveredUrls.length === 0) {
      console.log("[agent] Search empty — using fallback sources");
      for (const u of FALLBACK_SOURCES) {
        discoveredUrls.push({ title: "", url: u, sourceUrl: u, snippet: "" });
      }
    }

    discoveredUrls = discoveredUrls.slice(0, maxSteps);
    const collectedCount = discoveredUrls.length;

    // Step 2: Resolve redirect URLs
    await svc.from("mcp_jobs").update({ output: { step: "scraping", sourcesCollected: collectedCount } }).eq("id", jobId);

    const sources: NormalizedSource[] = [];
    for (const item of discoveredUrls) {
      const needsResolve = isRedirectUrl(item.url);
      let finalUrl = item.url;
      let resolveStatus: NormalizedSource["resolveStatus"] = "unchanged";
      let resolveError: string | undefined;

      if (needsResolve) {
        const resolved = await resolveRedirect(item.url);
        finalUrl = resolved.finalUrl;
        resolveStatus = resolved.resolved ? "resolved" : "failed";
        resolveError = resolved.error;
        console.log("[agent] Resolved:", item.url, "→", finalUrl);
      }

      // Scrape the final URL
      let title = item.title;
      let markdown = "";
      let scrapeStatus: NormalizedSource["scrapeStatus"] = "failed";
      let scrapeError: string | undefined;

      try {
        const scraped = await scrapeUrl(finalUrl);
        markdown = scraped.markdown.slice(0, 6000);
        title = title || scraped.title;
        scrapeStatus = markdown.length >= MIN_USABLE_CONTENT_LENGTH ? "success" : "empty";
        console.log("[agent] Scraped OK:", finalUrl, "len:", markdown.length);
      } catch (e) {
        scrapeError = e instanceof Error ? e.message : "scrape failed";
        console.log("[agent] Scrape failed:", finalUrl, scrapeError);
      }

      sources.push({
        sourceUrl: item.sourceUrl,
        finalUrl,
        title: title || extractDomain(finalUrl),
        publisher: extractDomain(finalUrl),
        excerpt: item.snippet || markdown.slice(0, 200),
        markdown,
        contentLength: markdown.length,
        resolveStatus: resolveError ? "failed" : resolveStatus,
        scrapeStatus,
        error: scrapeError || resolveError,
      });

      // Progress update
      await svc.from("mcp_jobs").update({
        output: {
          step: "scraping",
          sourcesCollected: collectedCount,
          scrapedCount: sources.filter(s => s.scrapeStatus !== "failed").length,
          totalSources: collectedCount,
        },
      }).eq("id", jobId);
    }

    // Compute evidence metrics
    const metrics: EvidenceMetrics = {
      sourcesCollected: collectedCount,
      sourcesResolved: sources.filter(s => s.resolveStatus === "resolved" || s.resolveStatus === "unchanged").length,
      sourcesScrapedSuccessfully: sources.filter(s => s.scrapeStatus === "success").length,
      sourcesUsableForSynthesis: sources.filter(s => s.scrapeStatus === "success" && s.contentLength >= MIN_USABLE_CONTENT_LENGTH).length,
      failedSources: sources.filter(s => s.scrapeStatus === "failed").length,
      emptyContentSources: sources.filter(s => s.scrapeStatus === "empty").length,
    };

    console.log("[agent] Evidence metrics:", JSON.stringify(metrics));

    // Build source summary (without full markdown) for status display
    const sourceSummary = sources.map(s => ({
      sourceUrl: s.sourceUrl,
      finalUrl: s.finalUrl,
      title: s.title,
      publisher: s.publisher,
      contentLength: s.contentLength,
      resolveStatus: s.resolveStatus,
      scrapeStatus: s.scrapeStatus,
      error: s.error,
    }));

    // Step 3: Synthesis quality gate
    const usableSources = sources.filter(s => s.scrapeStatus === "success" && s.contentLength >= MIN_USABLE_CONTENT_LENGTH);

    if (usableSources.length === 0) {
      // No usable evidence — do not synthesize
      console.log("[agent] No usable article content — returning low-evidence result");
      await svc.from("mcp_jobs").update({
        status: "completed",
        output: {
          step: "completed",
          synthesis: null,
          groundedness: "none",
          warning: "No usable article content could be extracted. All sources either failed to scrape, returned empty content, or were redirect/RSS URLs that could not be resolved to final articles.",
          evidenceMetrics: metrics,
          sources: sourceSummary,
          scrapedCount: metrics.sourcesScrapedSuccessfully,
        },
      }).eq("id", jobId);
      return;
    }

    const isWeakEvidence = usableSources.length <= 1 || usableSources.length < collectedCount * 0.3;

    await svc.from("mcp_jobs").update({
      output: {
        step: "synthesizing",
        scrapedCount: metrics.sourcesScrapedSuccessfully,
        evidenceMetrics: metrics,
        sources: sourceSummary,
      },
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
        sourcesUsed: usableSources.map(s => s.finalUrl),
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
        { name: "chat", description: "Send a conversational message to the AI assistant", inputSchema: { type: "object", properties: { message: { type: "string" }, history: { type: "array" } }, required: ["message"] } },
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
          } else {
            const systemPrompt = "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully. Only use tools when explicitly requested.";
            const messages = [{ role: "system", content: systemPrompt }];
            if (args.history && Array.isArray(args.history)) {
              for (const msg of args.history) {
                messages.push({ role: msg.role, content: msg.content });
              }
            }
            messages.push({ role: "user", content: args.message });
            const aiHeaders: Record<string, string> = {
              Authorization: `Bearer ${aiSettings.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://id-preview--4485e6f5-86ea-4999-acd7-7209fb13e21d.lovable.app",
              "X-Title": "Personal Firecrawl MCP",
            };
            console.log("[chat] AI request:", aiSettings.baseUrl, aiSettings.model);
            const aiRes = await fetch(`${aiSettings.baseUrl}/chat/completions`, {
              method: "POST",
              headers: aiHeaders,
              body: JSON.stringify({ model: aiSettings.model, messages, max_tokens: 4096 }),
            });
            const aiBody = await aiRes.text();
            console.log("[chat] AI response status:", aiRes.status, "body:", aiBody.slice(0, 500));
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
              const answer = aiData.choices?.[0]?.message?.content;
              if (!answer) {
                console.log("[chat] Full AI response:", JSON.stringify(aiData).slice(0, 1000));
                result = { content: [{ type: "text", text: `AI returned no content. Raw response: ${JSON.stringify(aiData).slice(0, 500)}` }], isError: true };
              } else {
                result = { content: [{ type: "text", text: answer }] };
              }
            }
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
