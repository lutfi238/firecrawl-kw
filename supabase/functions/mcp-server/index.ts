import { Hono } from "hono";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ========== Get AI provider settings from settings table ==========
async function getAiSettings(authHeader: string | null): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !authHeader) return null;

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", user.id)
      .in("key", ["ai_base_url", "ai_api_key", "ai_model"]);

    if (error || !data) return null;

    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value ?? "";

    if (!map.ai_api_key) return null;

    return {
      baseUrl: map.ai_base_url || "https://api.openai.com/v1",
      apiKey: map.ai_api_key,
      model: map.ai_model || "gpt-4o-mini",
    };
  } catch {
    return null;
  }
}

// Module-level store for current request's auth header and GitHub PAT
let currentAuthHeader: string | null = null;
let currentGithubToken: string | null = null;

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

// ========== Resolve Google News redirect ==========
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS/2.0)" },
      signal: AbortSignal.timeout(5000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

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

      // Parse all items first
      const rawItems: Array<{ title: string; rawLink: string; rawDesc: string }> = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let m;
      while ((m = itemRegex.exec(xml)) !== null && rawItems.length < maxResults) {
        const item = m[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
        // Extract link - handle CDATA and newlines around link content
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

      // Resolve redirects in parallel for Google News URLs
      const items = await Promise.all(rawItems.map(async ({ title, rawLink, rawDesc }) => {
        let finalUrl = rawLink;
        if (rawLink.includes("news.google.com")) {
          finalUrl = await resolveRedirect(rawLink);
        }

        // Google News descriptions just repeat title + source — not useful
        // Only use snippet if it contains real descriptive text beyond the title
        let snippet = "";
        if (rawDesc) {
          const cleaned = rawDesc
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "").trim();
          // Check if the cleaned text is substantially different from the title
          const titleLower = title.toLowerCase();
          const cleanedLower = cleaned.toLowerCase();
          const isDifferent = !cleanedLower.includes(titleLower) && !titleLower.includes(cleanedLower);
          if (isDifferent && cleaned.length > 30) {
            snippet = cleaned.slice(0, 200);
          }
        }

        return { title, url: finalUrl, snippet };
      }));

      // Deduplicate by URL
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

// ========== Hono App ==========
const app = new Hono();


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-github-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

// Health check GET handler
app.get("/*", (c) => {
  return c.json(
    { status: "ok", server: "personal-firecrawl", version: "1.0.0", tools: 10 },
    200,
    corsHeaders
  );
});

// CORS preflight
app.options("/*", (c) => {
  return new Response(null, { headers: corsHeaders });
});

// MCP POST handler - manual JSON-RPC dispatch
app.post("/*", async (c) => {
  currentGithubToken = c.req.header("x-github-token") || null;
  currentAuthHeader = c.req.header("authorization") || null;

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
          serverInfo: { name: "personal-firecrawl", version: "1.0.0" },
        },
      }, 200, corsHeaders);
    }

    if (method === "tools/list") {
      const toolDefs = [
        { name: "search", description: "Search the web using DuckDuckGo", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
        { name: "scrape", description: "Fetch a URL and convert HTML to Markdown", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
        { name: "scrape_js", description: "Scrape a JS-rendered page via Railway renderer", inputSchema: { type: "object", properties: { url: { type: "string" }, waitFor: { type: "number" } }, required: ["url"] } },
        { name: "crawl", description: "BFS crawl a website staying on the same domain", inputSchema: { type: "object", properties: { url: { type: "string" }, maxPages: { type: "number" }, extractContent: { type: "boolean" } }, required: ["url"] } },
        { name: "map", description: "Fast URL-only crawl to map all links on a domain", inputSchema: { type: "object", properties: { url: { type: "string" }, maxPages: { type: "number" } }, required: ["url"] } },
        { name: "extract", description: "Scrape URL and use AI to extract structured data", inputSchema: { type: "object", properties: { url: { type: "string" }, prompt: { type: "string" }, schema: { type: "string" } }, required: ["url", "prompt"] } },
        { name: "screenshot", description: "Take a screenshot via Railway renderer", inputSchema: { type: "object", properties: { url: { type: "string" }, width: { type: "number" }, height: { type: "number" } }, required: ["url"] } },
        { name: "search_and_scrape", description: "Search then scrape top results", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
        { name: "html_to_markdown", description: "Convert HTML string to Markdown", inputSchema: { type: "object", properties: { html: { type: "string" } }, required: ["html"] } },
        { name: "batch_scrape", description: "Scrape multiple URLs in parallel", inputSchema: { type: "object", properties: { urls: { type: "string" } }, required: ["urls"] } },
      ];
      return c.json({ jsonrpc: "2.0", id, result: { tools: toolDefs } }, 200, corsHeaders);
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let result;

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
          const rendererUrl = Deno.env.get("RAILWAY_RENDERER_URL");
          if (!rendererUrl) {
            result = { content: [{ type: "text", text: "Error: RAILWAY_RENDERER_URL not configured." }], isError: true };
          } else {
            const secret = Deno.env.get("RAILWAY_SECRET") || "";
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
        case "crawl": {
          const visited = new Set<string>();
          const queue: string[] = [args.url];
          const results: Array<{ url: string; title?: string; markdown?: string }> = [];
          const limit = args.maxPages || 10;
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
          }
          result = { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
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
          const aiSettings = await getAiSettings(currentAuthHeader);
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
              // Try to parse error details
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
          const rendererUrl = Deno.env.get("RAILWAY_RENDERER_URL");
          if (!rendererUrl) {
            result = { content: [{ type: "text", text: "Error: RAILWAY_RENDERER_URL not configured." }], isError: true };
          } else {
            const secret = Deno.env.get("RAILWAY_SECRET") || "";
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
        case "batch_scrape": {
          const urlList = (args.urls as string).split(",").map((u: string) => u.trim()).filter(Boolean);
          const batchResults = await Promise.all(
            urlList.map(async (url: string) => {
              try {
                const { markdown, title } = await scrapeUrl(url);
                return `# ${title}\nURL: ${url}\n\n${markdown.slice(0, 4000)}`;
              } catch (e) {
                return `# Error\nURL: ${url}\nFailed: ${e instanceof Error ? e.message : "unknown"}`;
              }
            })
          );
          result = { content: [{ type: "text", text: batchResults.join("\n\n---\n\n") }] };
          break;
        }
        case "chat": {
          const aiSettings = await getAiSettings(currentAuthHeader);
          if (!aiSettings) {
            result = { content: [{ type: "text", text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key." }], isError: true };
          } else {
            const systemPrompt = "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully. Only use tools when explicitly requested.";
            const messages = [{ role: "system", content: systemPrompt }];
            // Support conversation history if provided
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

Deno.serve(app.fetch);
