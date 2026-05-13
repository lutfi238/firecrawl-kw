import type { AiSettings } from "../ai/settings.ts";

export function getToolDefinitions(
  userSettings: Record<string, string>,
  aiSettings: AiSettings | null,
) {
  const extractDesc = aiSettings
    ? `Scrape URL and use AI (${aiSettings.model}) to extract structured data`
    : "Scrape URL and use AI to extract structured data (not configured)";
  const rendererProvider = userSettings.renderer_provider || "none";
  const rendererReady =
    rendererProvider === "browserless"
      ? !!userSettings.renderer_secret
      : rendererProvider === "custom"
        ? !!userSettings.renderer_url
        : false;
  const scrapeJsDesc = rendererReady
    ? `Scrape a JS-rendered page using a headless browser via ${rendererProvider}`
    : "Scrape a JS-rendered page (falls back to plain HTTP if no renderer configured)";
  const screenshotDesc = rendererReady
    ? `Take a screenshot via ${rendererProvider} headless browser`
    : "Take a screenshot (disabled - configure Render renderer in Settings)";
  const agentDesc = aiSettings
    ? `Autonomous AI research agent — searches, scrapes, and synthesizes information using ${aiSettings.model}`
    : "Autonomous AI research agent (not configured — set AI provider in Settings)";

  return [
    {
      name: "search",
      description: "Search the web using DuckDuckGo",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "scrape",
      description: "Fetch a URL and convert HTML to Markdown",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL to scrape." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "scrape_js",
      description: scrapeJsDesc,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Target URL to render and scrape.",
          },
          waitFor: {
            type: "number",
            description: "Optional wait time in milliseconds before capture.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "crawl",
      description: "Async BFS crawl a website — returns jobId for polling",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Start URL for the crawl." },
          maxPages: { type: "number", description: "Maximum pages to crawl." },
          extractContent: {
            type: "boolean",
            description: "Whether to extract page content while crawling.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "map",
      description: "Fast URL-only crawl to map all links on a domain",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Start URL for the map operation.",
          },
          maxPages: {
            type: "number",
            description: "Maximum pages to inspect.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "extract",
      description: extractDesc,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Target URL to extract data from.",
          },
          prompt: { type: "string", description: "Extraction instructions." },
          schema: {
            type: "string",
            description:
              "Optional JSON schema or structure hint for the output.",
          },
        },
        required: ["url", "prompt"],
        additionalProperties: false,
      },
    },
    {
      name: "screenshot",
      description: screenshotDesc,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL to capture." },
          width: { type: "number", description: "Viewport width in pixels." },
          height: { type: "number", description: "Viewport height in pixels." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "search_and_scrape",
      description: "Search then scrape top results",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          maxResults: {
            type: "number",
            description: "Maximum search results to scrape.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "test_ai_provider",
      description:
        "Test the saved AI provider from backend without exposing the API key in browser requests",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "github_models_catalog",
      description:
        "List available GitHub Models using a token with models:read",
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description:
              "Optional GitHub token with models:read. If omitted, the saved AI API key is used when AI provider is GitHub Models.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "html_to_markdown",
      description: "Convert HTML string to Markdown",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "Raw HTML string to convert." },
        },
        required: ["html"],
        additionalProperties: false,
      },
    },
    {
      name: "batch_scrape",
      description: "Async scrape multiple URLs — returns jobId for polling",
      inputSchema: {
        type: "object",
        properties: {
          urls: {
            type: "string",
            description:
              "URLs to scrape, typically newline- or comma-separated.",
          },
        },
        required: ["urls"],
        additionalProperties: false,
      },
    },
    {
      name: "chat",
      description:
        "AI assistant with tools-first orchestration — searches, scrapes, and synthesizes evidence for factual/ranking queries; lightweight for casual chat. Pass mode:'synthesis' to bypass orchestration for direct LLM calls.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Current user message." },
          history: {
            type: "array",
            description: "Prior chat messages in order.",
            items: {
              type: "object",
              properties: {
                role: {
                  type: "string",
                  enum: ["system", "user", "assistant", "tool"],
                  description: "Message role.",
                },
                content: {
                  type: "string",
                  description: "Message text content.",
                },
              },
              required: ["role", "content"],
              additionalProperties: false,
            },
          },
          images: {
            type: "array",
            description: "Optional image data URIs for multimodal chat.",
            items: {
              type: "string",
              description: "Base64 data URI or image URL.",
            },
          },
          mode: {
            type: "string",
            enum: ["orchestrate", "synthesis"],
            description:
              "orchestrate (default): full intent routing. synthesis: bypass orchestration, direct LLM call.",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "check_crawl_status",
      description: "Check status of an async crawl job",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "Job ID returned from crawl." },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
    },
    {
      name: "check_batch_status",
      description: "Check status of an async batch scrape job",
      inputSchema: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "Job ID returned from batch_scrape.",
          },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
    },
    {
      name: "agent",
      description: agentDesc,
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Research prompt or task description.",
          },
          urls: {
            type: "array",
            description: "Optional seed URLs to prioritize during research.",
            items: { type: "string", description: "Seed URL." },
          },
          schema: {
            type: "string",
            description: "Optional desired output schema or format hint.",
          },
          maxSteps: {
            type: "number",
            description: "Optional upper bound for research iterations.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
    {
      name: "agent_status",
      description: "Check status of an autonomous agent research job",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "Job ID returned from agent." },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
    },
  ];
}
