import { describe, expect, it } from "vitest";

import { dedupeSourcesByContent, dedupeSourcesPreservingSeeds } from "../../../supabase/functions/mcp-server/tools/agent/content";

describe("dedupeSourcesByContent", () => {
  it("drops later near-identical sources", () => {
    const sources = [
      { title: "A", markdown: "Model context window: 1,000,000 tokens. Max output: 128,000 tokens." },
      { title: "B", markdown: "Model context window 1000000 tokens max output 128000 tokens" },
      { title: "C", markdown: "Different pricing information for another provider." },
    ];

    expect(dedupeSourcesByContent(sources).map((s) => s.title)).toEqual(["A", "C"]);
  });

  it("retains overlapping vendor seed URLs", () => {
    const sources = [
      { finalUrl: "https://platform.openai.com/docs/models", markdown: "Shared nav content with model table" },
      { finalUrl: "https://platform.openai.com/docs/pricing", markdown: "Shared nav content with model table" },
    ];

    expect(dedupeSourcesPreservingSeeds(sources, [
      "https://platform.openai.com/docs/models",
      "https://platform.openai.com/docs/pricing",
    ])).toHaveLength(2);
  });
});
