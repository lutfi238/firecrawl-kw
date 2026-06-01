import { describe, expect, it } from "vitest";

import { extractFreshness } from "../../../supabase/functions/mcp-server/scrapers/freshness";

describe("extractFreshness", () => {
  it("extracts Last-Modified header date", () => {
    const headers = new Headers({ "last-modified": "Fri, 29 May 2026 00:00:00 GMT" });
    expect(extractFreshness("", headers)?.toISOString()).toBe("2026-05-29T00:00:00.000Z");
  });

  it("extracts article meta dates", () => {
    const html = '<meta property="article:published_time" content="2026-05-28T10:00:00Z">';
    expect(extractFreshness(html, new Headers())?.toISOString()).toBe("2026-05-28T10:00:00.000Z");
  });

  it("extracts JSON-LD dates", () => {
    const html = '<script type="application/ld+json">{"dateModified":"2026-05-27"}</script>';
    expect(extractFreshness(html, new Headers())?.toISOString()).toBe("2026-05-27T00:00:00.000Z");
  });

  it("extracts time tag dates", () => {
    const html = '<time datetime="2026-05-26T12:00:00Z">May 26</time>';
    expect(extractFreshness(html, new Headers())?.toISOString()).toBe("2026-05-26T12:00:00.000Z");
  });

  it("extracts body updated dates", () => {
    const html = "<main>Last updated 2026-05-25 with current model information.</main>";
    expect(extractFreshness(html, new Headers())?.toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });
});
