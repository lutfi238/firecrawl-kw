import { describe, expect, it } from "vitest";

import { isAggregatorUrl } from "../../../supabase/functions/mcp-server/tools/agent/sourceFilters";

describe("agent aggregator blocklist", () => {
  it.each([
    "https://news.google.com/rss/articles/CBMiabc?oc=5",
    "https://www.bing.com/news/search?q=claude",
    "https://news.yahoo.com/ai-model-specs-123.html",
    "https://www.msn.com/en-us/news/technology/story",
    "https://flipboard.com/article/example",
    "https://smartnews.com/en/us/article/example",
    "https://apple.news/ABC123",
  ])("rejects aggregator URL %s", (url) => {
    expect(isAggregatorUrl(url)).toBe(true);
  });

  it("does not reject non-news Bing pages", () => {
    expect(isAggregatorUrl("https://www.bing.com/search?q=claude")).toBe(false);
  });
});
