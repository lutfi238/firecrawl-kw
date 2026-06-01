import { describe, expect, it, vi } from "vitest";
import {
  decodeEscapedUrl,
  isGoogleNewsRssWrapper,
  normalizeResolvedUrl,
  resolveGoogleNewsUrl,
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

  it("resolves Google News wrappers through HTTP redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      url: "https://example.com/article",
    }));

    await expect(resolveGoogleNewsUrl("https://news.google.com/rss/articles/CBMiabc?oc=5")).resolves.toBe("https://example.com/article");
  });

  it("falls back to token decoding when HTTP redirect stays on Google News", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      url: "https://news.google.com/rss/articles/CBMiabc?oc=5",
    }));
    const payload = "\u0000https://publisher.example.com/model-specs\u0000";
    const token = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    await expect(resolveGoogleNewsUrl(`https://news.google.com/rss/articles/${token}?oc=5`)).resolves.toBe("https://publisher.example.com/model-specs");
  });

  it("throws when Google News wrappers cannot be resolved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      url: "https://news.google.com/rss/articles/not-base64?oc=5",
    }));

    await expect(resolveGoogleNewsUrl("https://news.google.com/rss/articles/not-base64?oc=5")).rejects.toThrow("Cannot resolve Google News wrapper");
  });
});