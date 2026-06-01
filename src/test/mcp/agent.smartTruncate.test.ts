import { describe, expect, it } from "vitest";

import { rankAndTruncateSources, smartTruncate } from "../../../supabase/functions/mcp-server/tools/agent/content";

describe("smartTruncate", () => {
  it("truncates around query keywords instead of the document head", () => {
    const head = "irrelevant introduction ".repeat(200);
    const target = "Claude Opus 4.8 context window is 1M tokens with 128K output.";
    const tail = " trailing details".repeat(200);

    const result = smartTruncate(`${head}${target}${tail}`, 260, "claude opus context window");

    expect(result).toContain("Claude Opus 4.8 context window");
    expect(result.startsWith("irrelevant introduction")).toBe(false);
  });

  it("keeps only top relevant sources when budget cannot give each source a useful floor", () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({
      title: `source-${i}`,
      markdown: i < 2
        ? `Claude Opus GPT context window max output ${i} `.repeat(200)
        : `irrelevant sidebar navigation ${i} `.repeat(200),
    }));

    const result = rankAndTruncateSources(sources, 6000, "Claude GPT context window");

    expect(result).toHaveLength(2);
    expect(result.map((source) => source.title)).toEqual(["source-0", "source-1"]);
    expect(result.every((source) => source.markdown.length >= 3000)).toBe(true);
  });
});
