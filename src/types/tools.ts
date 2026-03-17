export interface ToolInputField {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  icon: string;
  category: "search" | "scrape" | "crawl" | "ai" | "utility";
  inputs: ToolInputField[];
  requiresRenderer?: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search",
    description: "Search the web using DuckDuckGo and return results with titles, URLs, and snippets.",
    icon: "Search",
    category: "search",
    inputs: [
      { name: "query", type: "string", description: "Search query", required: true, placeholder: "e.g. latest web scraping techniques" },
      { name: "maxResults", type: "number", description: "Maximum number of results", default: 10, placeholder: "10" },
    ],
  },
  {
    name: "scrape",
    description: "Fetch a URL and convert its HTML content to clean Markdown.",
    icon: "FileText",
    category: "scrape",
    inputs: [
      { name: "url", type: "string", description: "URL to scrape", required: true, placeholder: "https://example.com" },
      { name: "includeLinks", type: "boolean", description: "Include hyperlinks in output", default: true },
    ],
  },
  {
    name: "scrape_js",
    description: "Scrape a JavaScript-rendered page using a headless browser via Render renderer.",
    requiresRenderer: true,
    icon: "Globe",
    category: "scrape",
    inputs: [
      { name: "url", type: "string", description: "URL to scrape (JS-rendered)", required: true, placeholder: "https://example.com/spa" },
      { name: "waitFor", type: "number", description: "Milliseconds to wait for JS rendering", default: 3000 },
    ],
  },
  {
    name: "crawl",
    description: "Crawl a website using BFS, staying on the same domain, with optional content extraction.",
    icon: "Network",
    category: "crawl",
    inputs: [
      { name: "url", type: "string", description: "Starting URL to crawl", required: true, placeholder: "https://docs.example.com" },
      { name: "maxPages", type: "number", description: "Maximum number of pages to crawl", default: 10, placeholder: "10" },
      { name: "extractContent", type: "boolean", description: "Extract markdown content from each page", default: false },
    ],
  },
  {
    name: "map",
    description: "Fast URL-only crawl to map all links on a domain without extracting content.",
    icon: "Map",
    category: "crawl",
    inputs: [
      { name: "url", type: "string", description: "Starting URL to map", required: true, placeholder: "https://docs.example.com" },
      { name: "maxPages", type: "number", description: "Maximum number of pages to map", default: 50, placeholder: "50" },
    ],
  },
  {
    name: "extract",
    description: "Scrape a URL and use AI to extract structured data.",
    icon: "Brain",
    category: "ai",
    inputs: [
      { name: "url", type: "string", description: "URL to extract data from", required: true, placeholder: "https://example.com/product" },
      { name: "prompt", type: "string", description: "What data to extract", required: true, placeholder: "Extract all product names and prices" },
      { name: "schema", type: "string", description: "Optional JSON schema for structured output", placeholder: '{"products": [{"name": "string", "price": "number"}]}' },
    ],
  },
  {
    name: "screenshot",
    description: "Take a screenshot of a URL using headless browser via Render renderer.",
    requiresRenderer: true,
    icon: "Camera",
    category: "utility",
    inputs: [
      { name: "url", type: "string", description: "URL to screenshot", required: true, placeholder: "https://example.com" },
      { name: "width", type: "number", description: "Viewport width", default: 1280 },
      { name: "height", type: "number", description: "Viewport height", default: 720 },
    ],
  },
  {
    name: "search_and_scrape",
    description: "Search the web then scrape and combine content from the top results.",
    icon: "SearchCode",
    category: "search",
    inputs: [
      { name: "query", type: "string", description: "Search query", required: true, placeholder: "e.g. React server components tutorial" },
      { name: "maxResults", type: "number", description: "Number of results to scrape", default: 3 },
    ],
  },
  {
    name: "html_to_markdown",
    description: "Convert raw HTML string to clean Markdown.",
    icon: "Code",
    category: "utility",
    inputs: [
      { name: "html", type: "string", description: "HTML string to convert", required: true, placeholder: "<h1>Hello</h1><p>World</p>" },
    ],
  },
  {
    name: "batch_scrape",
    description: "Scrape multiple URLs in parallel and return combined results.",
    icon: "Layers",
    category: "scrape",
    inputs: [
      { name: "urls", type: "string", description: "Comma-separated list of URLs", required: true, placeholder: "https://a.com, https://b.com" },
      { name: "includeLinks", type: "boolean", description: "Include hyperlinks in output", default: true },
    ],
  },
];

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
