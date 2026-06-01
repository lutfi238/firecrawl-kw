import { describe, expect, it } from "vitest";

import { seedUrlsForQuery } from "../../../supabase/functions/mcp-server/tools/agent/seedDocs";

describe("agent authoritative doc seeds", () => {
  it("injects Anthropic docs for Claude model queries", () => {
    expect(seedUrlsForQuery("claude opus context window")).toContain(
      "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    );
  });

  it("injects no seeds for unrelated queries", () => {
    expect(seedUrlsForQuery("random nonsense")).toEqual([]);
  });
});
