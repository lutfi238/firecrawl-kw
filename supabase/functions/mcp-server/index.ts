import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";

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
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" },
  });
  const html = await res.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td class="result-snippet">([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "").trim() });
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

  // Fallback: broader pattern
  if (results.length === 0) {
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

// ========== MCP Server ==========
const app = new Hono();

const mcpServer = new McpServer({
  name: "personal-firecrawl",
  version: "1.0.0",
});

// 1. search
mcpServer.tool({
  name: "search",
  description: "Search the web using DuckDuckGo",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", description: "Max results (default 10)" },
    },
    required: ["query"],
  },
  handler: async ({ query, maxResults = 10 }) => {
    const results = await searchDDG(query as string, maxResults as number);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
});

// 2. scrape
mcpServer.tool({
  name: "scrape",
  description: "Fetch a URL and convert HTML to Markdown",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to scrape" },
    },
    required: ["url"],
  },
  handler: async ({ url }) => {
    const { markdown, title } = await scrapeUrl(url as string);
    return {
      content: [{ type: "text", text: `# ${title}\n\n${markdown}` }],
    };
  },
});

// 3. scrape_js
mcpServer.tool({
  name: "scrape_js",
  description: "Scrape a JS-rendered page via Railway renderer",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to scrape" },
      waitFor: { type: "number", description: "Wait ms for JS (default 3000)" },
    },
    required: ["url"],
  },
  handler: async ({ url, waitFor = 3000 }) => {
    const rendererUrl = Deno.env.get("RAILWAY_RENDERER_URL");
    if (!rendererUrl) {
      return { content: [{ type: "text", text: "Error: RAILWAY_RENDERER_URL not configured. Set it in Settings." }], isError: true };
    }
    const secret = Deno.env.get("RAILWAY_SECRET") || "";
    const res = await fetch(`${rendererUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Secret": secret },
      body: JSON.stringify({ url, waitFor }),
    });
    if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
    const { html } = await res.json();
    return { content: [{ type: "text", text: htmlToMarkdown(html) }] };
  },
});

// 4. crawl
mcpServer.tool({
  name: "crawl",
  description: "BFS crawl a website staying on the same domain",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Starting URL" },
      maxPages: { type: "number", description: "Max pages (default 10)" },
      extractContent: { type: "boolean", description: "Extract markdown per page" },
    },
    required: ["url"],
  },
  handler: async ({ url, maxPages = 10, extractContent = false }) => {
    const visited = new Set<string>();
    const queue: string[] = [url as string];
    const results: Array<{ url: string; title?: string; markdown?: string }> = [];

    while (queue.length > 0 && visited.size < (maxPages as number)) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      try {
        const res = await fetch(current, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) continue;
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : current;

        const entry: { url: string; title?: string; markdown?: string } = { url: current, title };
        if (extractContent) entry.markdown = htmlToMarkdown(html);
        results.push(entry);

        const links = extractLinks(html, current);
        for (const link of links) {
          if (!visited.has(link)) queue.push(link);
        }
      } catch {
        // skip failed pages
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  },
});

// 5. map
mcpServer.tool({
  name: "map",
  description: "Fast URL-only crawl to map all links on a domain",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Starting URL" },
      maxPages: { type: "number", description: "Max pages (default 50)" },
    },
    required: ["url"],
  },
  handler: async ({ url, maxPages = 50 }) => {
    const visited = new Set<string>();
    const queue: string[] = [url as string];

    while (queue.length > 0 && visited.size < (maxPages as number)) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      try {
        const res = await fetch(current, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) continue;
        const html = await res.text();
        const links = extractLinks(html, current);
        for (const link of links) {
          if (!visited.has(link)) queue.push(link);
        }
      } catch {
        // skip
      }
    }

    return { content: [{ type: "text", text: JSON.stringify([...visited], null, 2) }] };
  },
});

// 6. extract
mcpServer.tool({
  name: "extract",
  description: "Scrape URL and use AI (Claude Haiku 4.5 via Copilot) to extract structured data",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to extract from" },
      prompt: { type: "string", description: "What to extract" },
      schema: { type: "string", description: "Optional JSON schema" },
    },
    required: ["url", "prompt"],
  },
  handler: async ({ url, prompt, schema }, { request }) => {
    const githubToken = request?.headers?.get?.("X-GitHub-Token");
    if (!githubToken) {
      return { content: [{ type: "text", text: "Error: X-GitHub-Token header required for extract tool." }], isError: true };
    }

    const { markdown } = await scrapeUrl(url as string);
    const truncated = markdown.slice(0, 12000);

    const copilotToken = await getCopilotToken(githubToken);

    const systemPrompt = schema
      ? `Extract the requested data from the web page content. Return valid JSON matching this schema: ${schema}`
      : "Extract the requested data from the web page content. Return structured JSON.";

    const aiRes = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        "Content-Type": "application/json",
        "Copilot-Integration-Id": "vscode-chat",
      },
      body: JSON.stringify({
        model: "claude-3.5-haiku",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${prompt}\n\n---PAGE CONTENT---\n${truncated}` },
        ],
        max_tokens: 4096,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return { content: [{ type: "text", text: `Copilot API error ${aiRes.status}: ${err}` }], isError: true };
    }

    const aiData = await aiRes.json();
    const answer = aiData.choices?.[0]?.message?.content ?? "No response";
    return { content: [{ type: "text", text: answer }] };
  },
});

// 7. screenshot
mcpServer.tool({
  name: "screenshot",
  description: "Take a screenshot via Railway renderer",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to screenshot" },
      width: { type: "number", description: "Width (default 1280)" },
      height: { type: "number", description: "Height (default 720)" },
    },
    required: ["url"],
  },
  handler: async ({ url, width = 1280, height = 720 }) => {
    const rendererUrl = Deno.env.get("RAILWAY_RENDERER_URL");
    if (!rendererUrl) {
      return { content: [{ type: "text", text: "Error: RAILWAY_RENDERER_URL not configured." }], isError: true };
    }
    const secret = Deno.env.get("RAILWAY_SECRET") || "";
    const res = await fetch(`${rendererUrl}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Secret": secret },
      body: JSON.stringify({ url, width, height }),
    });
    if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
    const { image } = await res.json();
    return { content: [{ type: "image", data: image, mimeType: "image/png" }] };
  },
});

// 8. search_and_scrape
mcpServer.tool({
  name: "search_and_scrape",
  description: "Search then scrape top results",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", description: "Results to scrape (default 3)" },
    },
    required: ["query"],
  },
  handler: async ({ query, maxResults = 3 }) => {
    const results = await searchDDG(query as string, maxResults as number);
    const scraped: string[] = [];

    for (const r of results) {
      try {
        const { markdown, title } = await scrapeUrl(r.url);
        scraped.push(`# ${title}\nURL: ${r.url}\n\n${markdown.slice(0, 4000)}\n\n---`);
      } catch {
        scraped.push(`# ${r.title}\nURL: ${r.url}\nFailed to scrape.\n\n---`);
      }
    }

    return { content: [{ type: "text", text: scraped.join("\n\n") }] };
  },
});

// 9. html_to_markdown
mcpServer.tool({
  name: "html_to_markdown",
  description: "Convert HTML string to Markdown",
  inputSchema: {
    type: "object",
    properties: {
      html: { type: "string", description: "HTML to convert" },
    },
    required: ["html"],
  },
  handler: async ({ html }) => {
    return { content: [{ type: "text", text: htmlToMarkdown(html as string) }] };
  },
});

// 10. batch_scrape
mcpServer.tool({
  name: "batch_scrape",
  description: "Scrape multiple URLs in parallel",
  inputSchema: {
    type: "object",
    properties: {
      urls: { type: "string", description: "Comma-separated URLs" },
    },
    required: ["urls"],
  },
  handler: async ({ urls }) => {
    const urlList = (urls as string).split(",").map((u) => u.trim()).filter(Boolean);
    const results = await Promise.all(
      urlList.map(async (url) => {
        try {
          const { markdown, title } = await scrapeUrl(url);
          return `# ${title}\nURL: ${url}\n\n${markdown.slice(0, 4000)}`;
        } catch (e) {
          return `# Error\nURL: ${url}\nFailed: ${e instanceof Error ? e.message : "unknown"}`;
        }
      })
    );
    return { content: [{ type: "text", text: results.join("\n\n---\n\n") }] };
  },
});

// ========== Transport ==========
const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  // CORS
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-github-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      },
    });
  }

  const response = await transport.handleRequest(c.req.raw, mcpServer);

  // Add CORS to response
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

Deno.serve(app.fetch);
