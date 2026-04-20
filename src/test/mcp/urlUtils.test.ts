import { describe, expect, it } from "vitest";
import { extractLinks, resolveUrl, sameOrigin } from "../../../supabase/functions/mcp-server/scrapers/urlUtils";

describe("urlUtils", () => {
  it("resolves relative URLs against a base URL", () => {
    expect(resolveUrl("https://example.com/base", "/a")).toBe("https://example.com/a");
  });

  it("returns true for URLs on the same origin", () => {
    expect(sameOrigin("https://example.com/x", "https://example.com/y")).toBe(true);
  });

  it("extracts same-origin links and removes duplicates", () => {
    const html = `
      <a href="/a">A</a>
      <a href="https://example.com/a?x=1">A2</a>
      <a href="https://other.com/b">B</a>
    `;

    expect(extractLinks(html, "https://example.com/root")).toEqual(["https://example.com/a"]);
  });
});