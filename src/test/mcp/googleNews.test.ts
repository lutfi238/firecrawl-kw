import { describe, expect, it } from "vitest";
import {
  decodeEscapedUrl,
  isGoogleNewsRssWrapper,
  normalizeResolvedUrl,
} from "../../../supabase/functions/mcp-server/scrapers/googleNews";

describe("googleNews helpers", () => {
  it("recognizes Google News RSS wrapper URLs", () => {
    expect(isGoogleNewsRssWrapper("https://news.google.com/rss/articles/abc")).toBe(true);
  });

  it("decodes escaped URLs", () => {
    expect(decodeEscapedUrl("https:\\/\\/example.com\\/x\\u003da\\u0026b\\u003dc")).toBe("https://example.com/x=a&b=c");
  });

  it("keeps valid normalized article URLs", () => {
    expect(normalizeResolvedUrl("https://example.com/article")).toBe("https://example.com/article");
  });

  it("rejects invalid normalized article targets", () => {
    expect(normalizeResolvedUrl("https://google.com")).toBeNull();
  });
});