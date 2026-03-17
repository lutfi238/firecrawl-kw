/**
 * Intent classifier for AI Chat orchestration.
 * Rule-based routing that maps user messages to MCP tool actions.
 */

export type ToolAction =
  | { tool: "search"; args: { query: string; maxResults?: number } }
  | { tool: "scrape"; args: { url: string } }
  | { tool: "scrape_js"; args: { url: string } }
  | { tool: "crawl"; args: { url: string; maxPages?: number } }
  | { tool: "map"; args: { url: string } }
  | { tool: "extract"; args: { url: string; prompt: string } }
  | { tool: "screenshot"; args: { url: string } }
  | { tool: "search_and_scrape"; args: { query: string; maxResults?: number } }
  | { tool: "html_to_markdown"; args: { html: string } }
  | { tool: "batch_scrape"; args: { urls: string } }
  | { tool: "check_crawl_status"; args: { jobId: string } }
  | { tool: "check_batch_status"; args: { jobId: string } }
  | { tool: "agent"; args: { prompt: string; urls?: string; maxSteps?: number } }
  | { tool: "agent_status"; args: { jobId: string } }
  | { tool: "chat"; args: { message: string; history?: Array<{ role: string; content: string }> } };

export interface IntentResult {
  actions: ToolAction[];
  reasoning: string;
  synthesize: boolean; // whether to run a synthesis step after tools
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Keywords that strongly signal evidence-needed queries
const EVIDENCE_KEYWORDS = [
  "latest", "newest", "recent", "current", "today", "2024", "2025", "2026",
  "top", "best", "ranking", "compare", "comparison", "versus", "vs",
  "news", "update", "announce", "release", "launch",
  "how much", "price", "cost", "salary", "revenue",
  "who is", "what is", "when did", "where is",
  "list of", "examples of", "alternatives to",
  "research", "investigate", "find out", "look up",
  "statistics", "stats", "data on", "numbers",
];

const CASUAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|cool|great|nice|got it|sure|yes|no|bye|help)\s*[.!?]*$/i,
  /^(what can you do|how do you work|what tools|what are your capabilities)/i,
  /^(explain|teach me|how does .* work|what is the difference between)/i,
];

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map(m => m[0]);
}

function isJobId(text: string): boolean {
  return UUID_REGEX.test(text.trim());
}

function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text) && text.length > 20;
}

function needsEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  return EVIDENCE_KEYWORDS.some(kw => lower.includes(kw));
}

function isCasual(text: string): boolean {
  return CASUAL_PATTERNS.some(p => p.test(text.trim()));
}

function isScreenshotRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("screenshot") || lower.includes("capture") || lower.includes("take a picture of");
}

function isCrawlRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("crawl") || lower.includes("all pages") || lower.includes("entire site") || lower.includes("whole website");
}

function isMapRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("map") || lower.includes("sitemap") || lower.includes("list all urls") || lower.includes("all links on");
}

function isExtractRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("extract") || lower.includes("structured data") || lower.includes("parse the") || lower.includes("get the data from");
}

function isDeepResearchRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("research") || lower.includes("analyze") || lower.includes("deep dive") ||
    lower.includes("comprehensive") || lower.includes("investigate") || lower.includes("detailed report") ||
    lower.includes("synthesis") || lower.includes("write a report")
  );
}

/**
 * Parse slash commands. Returns null if input is not a slash command.
 */
function parseSlashCommand(text: string): IntentResult | null {
  const match = text.match(/^\/(\w+)\s*([\s\S]*)/);
  if (!match) return null;

  const cmd = match[1].toLowerCase();
  const arg = match[2].trim();

  switch (cmd) {
    case "search":
      return { actions: [{ tool: "search", args: { query: arg } }], reasoning: "Slash command: /search", synthesize: false };
    case "scrape":
      return { actions: [{ tool: "scrape", args: { url: arg } }], reasoning: "Slash command: /scrape", synthesize: false };
    case "scrape_js":
      return { actions: [{ tool: "scrape_js", args: { url: arg } }], reasoning: "Slash command: /scrape_js", synthesize: false };
    case "crawl":
      return { actions: [{ tool: "crawl", args: { url: arg } }], reasoning: "Slash command: /crawl", synthesize: false };
    case "map":
      return { actions: [{ tool: "map", args: { url: arg } }], reasoning: "Slash command: /map", synthesize: false };
    case "extract": {
      const urls = extractUrls(arg);
      const prompt = arg.replace(URL_REGEX, "").trim();
      if (urls.length > 0) {
        return { actions: [{ tool: "extract", args: { url: urls[0], prompt: prompt || "Extract key data" } }], reasoning: "Slash command: /extract", synthesize: false };
      }
      return { actions: [{ tool: "chat", args: { message: "The /extract command requires a URL and a prompt. Usage: /extract https://example.com Extract all prices" } }], reasoning: "Missing URL for /extract", synthesize: false };
    }
    case "screenshot":
      return { actions: [{ tool: "screenshot", args: { url: arg } }], reasoning: "Slash command: /screenshot", synthesize: false };
    case "batch": {
      const urls = arg.split(",").map(u => u.trim()).filter(Boolean);
      return { actions: [{ tool: "batch_scrape", args: { urls: urls.join(", ") } }], reasoning: "Slash command: /batch", synthesize: false };
    }
    case "html":
      return { actions: [{ tool: "html_to_markdown", args: { html: arg } }], reasoning: "Slash command: /html", synthesize: false };
    case "status": {
      // Try to guess which status tool based on context
      if (UUID_REGEX.test(arg)) {
        return { actions: [{ tool: "agent_status", args: { jobId: arg.match(UUID_REGEX)![0] } }], reasoning: "Slash command: /status — trying agent_status first", synthesize: false };
      }
      return { actions: [{ tool: "chat", args: { message: "The /status command requires a job ID (UUID)." } }], reasoning: "Missing job ID", synthesize: false };
    }
    case "agent":
      return { actions: [{ tool: "agent", args: { prompt: arg } }], reasoning: "Slash command: /agent", synthesize: false };
    case "search_and_scrape":
      return { actions: [{ tool: "search_and_scrape", args: { query: arg } }], reasoning: "Slash command: /search_and_scrape", synthesize: false };
    case "chat":
      return { actions: [{ tool: "chat", args: { message: arg } }], reasoning: "Slash command: /chat — direct chat mode", synthesize: false };
    default:
      return null;
  }
}

/**
 * Classify user intent into one or more tool actions.
 */
export function classifyIntent(
  text: string,
  history: Array<{ role: string; content: string }> = [],
  options: { rendererAvailable: boolean } = { rendererAvailable: false }
): IntentResult {
  // 1. Slash commands take absolute priority
  const slashResult = parseSlashCommand(text);
  if (slashResult) return slashResult;

  const urls = extractUrls(text);
  const textWithoutUrls = text.replace(URL_REGEX, "").trim();

  // 2. Raw HTML input
  if (looksLikeHtml(text) && urls.length === 0) {
    return {
      actions: [{ tool: "html_to_markdown", args: { html: text } }],
      reasoning: "Input contains HTML markup → converting to markdown",
      synthesize: false,
    };
  }

  // 3. Job ID status check
  if (isJobId(text.trim()) && textWithoutUrls.length < 50) {
    const jobId = text.trim().match(UUID_REGEX)![0];
    // Check last conversation context for which type of job
    const lastToolMention = [...history].reverse().find(m =>
      m.content.includes("agent") || m.content.includes("crawl") || m.content.includes("batch")
    );
    if (lastToolMention?.content.includes("crawl")) {
      return { actions: [{ tool: "check_crawl_status", args: { jobId } }], reasoning: "Job ID detected + crawl context → checking crawl status", synthesize: false };
    }
    if (lastToolMention?.content.includes("batch")) {
      return { actions: [{ tool: "check_batch_status", args: { jobId } }], reasoning: "Job ID detected + batch context → checking batch status", synthesize: false };
    }
    return { actions: [{ tool: "agent_status", args: { jobId } }], reasoning: "Job ID detected → checking agent status (default)", synthesize: false };
  }

  // 4. Screenshot request with URL
  if (isScreenshotRequest(text) && urls.length > 0) {
    if (!options.rendererAvailable) {
      return {
        actions: [{ tool: "chat", args: { message: "⚠️ Screenshot tool requires the JS renderer to be configured. Go to Settings → Renderer to set it up." } }],
        reasoning: "Screenshot requested but renderer unavailable",
        synthesize: false,
      };
    }
    return { actions: [{ tool: "screenshot", args: { url: urls[0] } }], reasoning: "Screenshot request with URL → screenshot tool", synthesize: false };
  }

  // 5. Extract request with URL
  if (isExtractRequest(text) && urls.length > 0) {
    return {
      actions: [{ tool: "extract", args: { url: urls[0], prompt: textWithoutUrls || "Extract key structured data" } }],
      reasoning: "Extract request with URL → extract tool",
      synthesize: false,
    };
  }

  // 6. Crawl request with URL
  if (isCrawlRequest(text) && urls.length > 0) {
    return {
      actions: [{ tool: "crawl", args: { url: urls[0] } }],
      reasoning: "Crawl request with URL → crawl tool",
      synthesize: false,
    };
  }

  // 7. Map request with URL
  if (isMapRequest(text) && urls.length > 0) {
    return {
      actions: [{ tool: "map", args: { url: urls[0] } }],
      reasoning: "Map/sitemap request with URL → map tool",
      synthesize: false,
    };
  }

  // 8. Multiple URLs → batch scrape
  if (urls.length >= 2) {
    return {
      actions: [{ tool: "batch_scrape", args: { urls: urls.join(", ") } }],
      reasoning: `${urls.length} URLs detected → batch scrape`,
      synthesize: false,
    };
  }

  // 9. Single URL with no special intent → scrape
  if (urls.length === 1 && textWithoutUrls.length < 20) {
    return {
      actions: [{ tool: "scrape", args: { url: urls[0] } }],
      reasoning: "Single URL detected → scraping page",
      synthesize: false,
    };
  }

  // 10. Single URL + question → scrape then synthesize
  if (urls.length === 1 && textWithoutUrls.length >= 20) {
    return {
      actions: [
        { tool: "scrape", args: { url: urls[0] } },
      ],
      reasoning: "URL + question → scraping page, then synthesizing answer",
      synthesize: true,
    };
  }

  // 11. Deep research request → agent
  if (isDeepResearchRequest(text)) {
    return {
      actions: [{ tool: "agent", args: { prompt: text } }],
      reasoning: "Deep research request → launching agent",
      synthesize: false,
    };
  }

  // 12. Casual/conversational → chat directly
  if (isCasual(text)) {
    return {
      actions: [{ tool: "chat", args: { message: text } }],
      reasoning: "Casual conversation → direct chat",
      synthesize: false,
    };
  }

  // 13. Evidence-needed factual question → search first, then synthesize
  if (needsEvidence(text)) {
    return {
      actions: [{ tool: "search_and_scrape", args: { query: text, maxResults: 3 } }],
      reasoning: "Factual/current question → searching web and scraping top results for evidence",
      synthesize: true,
    };
  }

  // 14. Default: for any non-trivial question, search first to ground the answer
  if (text.length > 30 && (text.includes("?") || text.endsWith("."))) {
    return {
      actions: [{ tool: "search", args: { query: text } }],
      reasoning: "Question detected → searching for evidence first",
      synthesize: true,
    };
  }

  // 15. Fallback → chat
  return {
    actions: [{ tool: "chat", args: { message: text } }],
    reasoning: "General message → chat",
    synthesize: false,
  };
}
