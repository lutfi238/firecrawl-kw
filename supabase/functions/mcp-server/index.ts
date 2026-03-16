import { Hono } from "hono";

// ========== Copilot Token Cache ==========
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getCopilotToken(githubToken: string): Promise<string> {
  const cached = tokenCache.get(githubToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "firecrawl-mcp/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to exchange GitHub token for Copilot token: ${res.status}`);
  }

  const data = await res.json();
  const expiresAt = new Date(data.expires_at).getTime() - 60_000;
  tokenCache.set(githubToken, { token: data.token, expiresAt });
  return data.token;
}

// Module-level store for current request's GitHub token
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

// ========== Search DDG ==========
async function searchDDG(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  });
  const html = await res.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match <a ... class="result-link" ... href="URL"> or <a ... href="URL" ... class="result-link">
  const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1] || m[3];
    const title = (m[2] || m[4] || "").replace(/<[^>]+>/g, "").trim();
    if (url && title) links.push({ url, title });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  if (results.length === 0) {
    // Fallback: grab any external links
    const broadRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = broadRegex.exec(html)) !== null && results.length < maxResults) {
      const url = m[1];
      if (!url.includes("duckduckgo.com")) {
        results.push({ title: m[2].replace(/<[^>]+>/g, "").trim(), url, snippet: "" });
      }
    }
  }

  return results;
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
          const results = await searchDDG(args.query, args.maxResults || 10);
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
          if (!currentGithubToken) {
            result = { content: [{ type: "text", text: "Error: X-GitHub-Token header required for extract tool." }], isError: true };
          } else {
            const { markdown } = await scrapeUrl(args.url);
            const truncated = markdown.slice(0, 12000);
            const copilotToken = await getCopilotToken(currentGithubToken);
            const systemPrompt = args.schema
              ? `Extract the requested data from the web page content. Return valid JSON matching this schema: ${args.schema}`
              : "Extract the requested data from the web page content. Return structured JSON.";
            const aiRes = await fetch("https://api.githubcopilot.com/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${copilotToken}`, "Content-Type": "application/json", "Copilot-Integration-Id": "vscode-chat" },
              body: JSON.stringify({ model: "claude-3.5-haiku", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `${args.prompt}\n\n---PAGE CONTENT---\n${truncated}` }], max_tokens: 4096 }),
            });
            if (!aiRes.ok) {
              const err = await aiRes.text();
              result = { content: [{ type: "text", text: `Copilot API error ${aiRes.status}: ${err}` }], isError: true };
            } else {
              const aiData = await aiRes.json();
              const answer = aiData.choices?.[0]?.message?.content ?? "No response";
              result = { content: [{ type: "text", text: answer }] };
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
          const searchResults = await searchDDG(args.query, args.maxResults || 3);
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
