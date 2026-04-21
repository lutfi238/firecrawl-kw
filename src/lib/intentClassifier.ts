/**
 * Intent classifier for AI Chat orchestration.
 * Rule-based routing that maps user messages to MCP tool actions.
 * Job registry persisted to localStorage for cross-refresh routing.
 */

import { detectRecencyProfile } from "@/lib/recency";

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
  synthesize: boolean;
  /** If set, this is a local-only message — skip tool execution entirely */
  localMessage?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const EVIDENCE_KEYWORDS = [
  "latest", "newest", "recent", "current", "today",
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
];

// ========== Persistent job registry (localStorage) ==========
export type JobType = "crawl" | "batch_scrape" | "agent";

interface StoredJob {
  jobId: string;
  type: JobType;
  createdAt: number;
}

const STORAGE_KEY = "mcp_recent_jobs";
const MAX_JOBS = 100;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadJobs(): StoredJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    // Prune expired
    return parsed.filter(
      (j: StoredJob) => j.jobId && j.type && j.createdAt && now - j.createdAt < MAX_AGE_MS
    );
  } catch {
    return [];
  }
}

function saveJobs(jobs: StoredJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-MAX_JOBS)));
  } catch { /* quota exceeded etc */ }
}

export function registerJob(jobId: string, type: JobType) {
  const jobs = loadJobs().filter(j => j.jobId !== jobId);
  jobs.push({ jobId, type, createdAt: Date.now() });
  saveJobs(jobs);
}

export function getJobType(jobId: string): JobType | undefined {
  const jobs = loadJobs();
  return jobs.find(j => j.jobId === jobId)?.type;
}

const STATUS_TOOL_MAP: Record<JobType, "check_crawl_status" | "check_batch_status" | "agent_status"> = {
  crawl: "check_crawl_status",
  batch_scrape: "check_batch_status",
  agent: "agent_status",
};

// ========== Helpers ==========
function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map(m => m[0]);
}

function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text) && text.length > 20;
}

export function needsEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  return EVIDENCE_KEYWORDS.some(kw => lower.includes(kw)) || detectRecencyProfile(text).mode !== "none";
}

function isCasual(text: string): boolean {
  return CASUAL_PATTERNS.some(p => p.test(text.trim()));
}

function isScreenshotRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("screenshot") || lower.includes("capture") || lower.includes("take a picture of");
}

function isJsRenderRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("js") || lower.includes("javascript") || lower.includes("spa") ||
    lower.includes("react") || lower.includes("dynamic") || lower.includes("client-side") ||
    lower.includes("rendered");
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
    lower.includes("deep dive") || lower.includes("comprehensive") ||
    lower.includes("detailed report") || lower.includes("write a report") ||
    lower.includes("in-depth analysis")
  );
}

// ========== Slash commands ==========
function parseSlashCommand(text: string, rendererAvailable: boolean): IntentResult | null {
  const match = text.match(/^\/(\w+)\s*([\s\S]*)/);
  if (!match) return null;

  const cmd = match[1].toLowerCase();
  const arg = match[2].trim();

  switch (cmd) {
    case "search":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/search <query>`" };
      return { actions: [{ tool: "search", args: { query: arg } }], reasoning: "Slash command: /search", synthesize: false };

    case "scrape":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/scrape <url>`" };
      return { actions: [{ tool: "scrape", args: { url: arg } }], reasoning: "Slash command: /scrape", synthesize: false };

    case "scrape_js":
      if (!rendererAvailable) return { actions: [], reasoning: "", synthesize: false, localMessage: "⚠️ JS renderer is not configured. Enable it in Settings → Renderer to use /scrape_js." };
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/scrape_js <url>`" };
      return { actions: [{ tool: "scrape_js", args: { url: arg } }], reasoning: "Slash command: /scrape_js", synthesize: false };

    case "crawl":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/crawl <url>`" };
      return { actions: [{ tool: "crawl", args: { url: arg } }], reasoning: "Slash command: /crawl", synthesize: false };

    case "map":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/map <url>`" };
      return { actions: [{ tool: "map", args: { url: arg } }], reasoning: "Slash command: /map", synthesize: false };

    case "extract": {
      const urls = extractUrls(arg);
      const prompt = arg.replace(URL_REGEX, "").trim();
      if (urls.length === 0) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/extract <url> <prompt>`\nExample: `/extract https://example.com Extract all product prices`" };
      return { actions: [{ tool: "extract", args: { url: urls[0], prompt: prompt || "Extract key data" } }], reasoning: "Slash command: /extract", synthesize: false };
    }

    case "screenshot":
      if (!rendererAvailable) return { actions: [], reasoning: "", synthesize: false, localMessage: "⚠️ JS renderer is not configured. Enable it in Settings → Renderer to use /screenshot." };
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/screenshot <url>`" };
      return { actions: [{ tool: "screenshot", args: { url: arg } }], reasoning: "Slash command: /screenshot", synthesize: false };

    case "search_and_scrape":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/search_and_scrape <query>`" };
      return { actions: [{ tool: "search_and_scrape", args: { query: arg, maxResults: 3 } }], reasoning: "Slash command: /search_and_scrape", synthesize: false };

    case "batch": {
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/batch <url1>, <url2>, ...`" };
      // Normalize: split by comma, newline, or space, then filter valid URLs
      const rawParts = arg.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const normalizedUrls = rawParts.map(p => {
        // If part looks like a URL already, use it; otherwise try to extract
        if (/^https?:\/\//i.test(p)) return p;
        const found = extractUrls(p);
        return found[0] || p;
      }).filter(u => /^https?:\/\//i.test(u));
      if (normalizedUrls.length === 0) return { actions: [], reasoning: "", synthesize: false, localMessage: "No valid URLs found. Usage: `/batch <url1>, <url2>, ...`" };
      return { actions: [{ tool: "batch_scrape", args: { urls: normalizedUrls.join(", ") } }], reasoning: `Slash command: /batch (${normalizedUrls.length} URLs)`, synthesize: false };
    }

    case "html":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/html <raw html>`" };
      return { actions: [{ tool: "html_to_markdown", args: { html: arg } }], reasoning: "Slash command: /html", synthesize: false };

    case "status": {
      const uuidMatch = arg.match(UUID_REGEX);
      if (!uuidMatch) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/status <job-uuid>`" };
      const jobId = uuidMatch[0];
      const knownType = getJobType(jobId);
      if (knownType) {
        return { actions: [{ tool: STATUS_TOOL_MAP[knownType], args: { jobId } }], reasoning: `Slash command: /status → ${knownType} job (from stored mapping)`, synthesize: false };
      }
      return { actions: [{ tool: "agent_status", args: { jobId } }], reasoning: "Slash command: /status → unknown job type, trying agent_status", synthesize: false };
    }

    case "agent":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/agent <research prompt>`" };
      return { actions: [{ tool: "agent", args: { prompt: arg } }], reasoning: "Slash command: /agent", synthesize: false };

    case "chat":
      if (!arg) return { actions: [], reasoning: "", synthesize: false, localMessage: "Usage: `/chat <message>`" };
      return { actions: [{ tool: "chat", args: { message: arg } }], reasoning: "Slash command: /chat — direct chat mode", synthesize: false };

    default:
      return { actions: [], reasoning: "", synthesize: false, localMessage: `Unknown command: /${cmd}. Type / to see available commands.` };
  }
}

/**
 * Classify user intent into tool actions.
 */
export function classifyIntent(
  text: string,
  history: Array<{ role: string; content: string }> = [],
  options: { rendererAvailable: boolean } = { rendererAvailable: false }
): IntentResult {
  // 1. Slash commands
  const slashResult = parseSlashCommand(text, options.rendererAvailable);
  if (slashResult) return slashResult;

  const urls = extractUrls(text);
  const textWithoutUrls = text.replace(URL_REGEX, "").trim();

  // 2. Raw HTML
  if (looksLikeHtml(text) && urls.length === 0) {
    return { actions: [{ tool: "html_to_markdown", args: { html: text } }], reasoning: "Input contains HTML markup → converting to markdown", synthesize: false };
  }

  // 3. Job UUID
  const uuidMatch = text.trim().match(UUID_REGEX);
  if (uuidMatch && textWithoutUrls.replace(UUID_REGEX, "").trim().length < 30) {
    const jobId = uuidMatch[0];
    const knownType = getJobType(jobId);
    if (knownType) {
      return { actions: [{ tool: STATUS_TOOL_MAP[knownType], args: { jobId } }], reasoning: `Job ID detected → ${knownType} status (from stored mapping)`, synthesize: false };
    }
    // Heuristic fallback from conversation history
    const lastToolMention = [...history].reverse().find(m =>
      m.content.includes("crawl") || m.content.includes("batch") || m.content.includes("agent")
    );
    if (lastToolMention?.content.toLowerCase().includes("crawl")) {
      return { actions: [{ tool: "check_crawl_status", args: { jobId } }], reasoning: "Job ID + crawl context → check_crawl_status", synthesize: false };
    }
    if (lastToolMention?.content.toLowerCase().includes("batch")) {
      return { actions: [{ tool: "check_batch_status", args: { jobId } }], reasoning: "Job ID + batch context → check_batch_status", synthesize: false };
    }
    return { actions: [{ tool: "agent_status", args: { jobId } }], reasoning: "Job ID detected → agent_status (default)", synthesize: false };
  }

  // 4. Screenshot + URL
  if (isScreenshotRequest(text) && urls.length > 0) {
    if (!options.rendererAvailable) {
      return { actions: [], reasoning: "", synthesize: false, localMessage: "⚠️ Screenshot requires the JS renderer. It's not currently configured. Go to Settings → Renderer to enable it." };
    }
    return { actions: [{ tool: "screenshot", args: { url: urls[0] } }], reasoning: "Screenshot request + URL → screenshot", synthesize: false };
  }

  // 5. JS render request + URL
  if (isJsRenderRequest(text) && urls.length > 0) {
    if (!options.rendererAvailable) {
      return { actions: [], reasoning: "", synthesize: false, localMessage: "⚠️ JS rendering requires the headless browser renderer. It's not currently configured. Go to Settings → Renderer to enable it. You can still use `/scrape` for static pages." };
    }
    return { actions: [{ tool: "scrape_js", args: { url: urls[0] } }], reasoning: "JS-rendered content request + URL → scrape_js", synthesize: false };
  }

  // 6. Extract + URL
  if (isExtractRequest(text) && urls.length > 0) {
    return { actions: [{ tool: "extract", args: { url: urls[0], prompt: textWithoutUrls || "Extract key structured data" } }], reasoning: "Extraction request + URL → extract", synthesize: false };
  }

  // 7. Crawl + URL
  if (isCrawlRequest(text) && urls.length > 0) {
    return { actions: [{ tool: "crawl", args: { url: urls[0] } }], reasoning: "Crawl request + URL → crawl", synthesize: false };
  }

  // 8. Map + URL
  if (isMapRequest(text) && urls.length > 0) {
    return { actions: [{ tool: "map", args: { url: urls[0] } }], reasoning: "Map request + URL → map", synthesize: false };
  }

  // 9. Multiple URLs → batch
  if (urls.length >= 2) {
    return { actions: [{ tool: "batch_scrape", args: { urls: urls.join(", ") } }], reasoning: `${urls.length} URLs → batch_scrape`, synthesize: false };
  }

  // 10. Single URL only → scrape
  if (urls.length === 1 && textWithoutUrls.length < 20) {
    return { actions: [{ tool: "scrape", args: { url: urls[0] } }], reasoning: "Single URL → scrape", synthesize: false };
  }

  // 11. Single URL + question → scrape then synthesize
  if (urls.length === 1 && textWithoutUrls.length >= 20) {
    return { actions: [{ tool: "scrape", args: { url: urls[0] } }], reasoning: "URL + question → scrape, then synthesize", synthesize: true };
  }

  // 12. Deep research → agent
  if (isDeepResearchRequest(text)) {
    return { actions: [{ tool: "agent", args: { prompt: text } }], reasoning: "Deep research request → agent", synthesize: false };
  }

  // 13. Casual → chat
  if (isCasual(text)) {
    return { actions: [{ tool: "chat", args: { message: text } }], reasoning: "Casual conversation → chat", synthesize: false };
  }

  // 14. Evidence-needed → search FIRST (cheap), then synthesize
  if (needsEvidence(text)) {
    return { actions: [{ tool: "search", args: { query: text, maxResults: 10 } }], reasoning: "Factual/current question → search first for evidence", synthesize: true };
  }

  // 15. Non-trivial question → search first
  if (text.length > 30 && (text.includes("?") || /\b(what|who|when|where|why|how|which|tell me|give me|show me)\b/i.test(text))) {
    return { actions: [{ tool: "search", args: { query: text, maxResults: 8 } }], reasoning: "Question detected → search for evidence first", synthesize: true };
  }

  // 16. Fallback → chat
  return { actions: [{ tool: "chat", args: { message: text } }], reasoning: "General message → chat", synthesize: false };
}
