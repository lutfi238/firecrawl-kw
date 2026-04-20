import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../../supabase/functions/mcp-server/scrapers/htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts h1 headings into markdown headings", () => {
    const html = "<h1>Hello</h1>";

    expect(htmlToMarkdown(html)).toContain("# Hello");
  });

  it("converts anchor tags into markdown links", () => {
    const html = '<p>Visit <a href="https://example.com">Example</a></p>';

    expect(htmlToMarkdown(html)).toContain("Visit [Example](https://example.com)");
  });

  it("removes script tag contents", () => {
    const html = '<script>alert("x")</script><p>Safe</p>';

    expect(htmlToMarkdown(html)).not.toContain('alert("x")');
  });
});