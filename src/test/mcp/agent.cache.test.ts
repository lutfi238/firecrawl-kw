import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: cacheMocks.createClient,
}));

describe("agent source cache", () => {
  beforeEach(() => {
    vi.resetModules();
    cacheMocks.createClient.mockReset();
    cacheMocks.from.mockReset();
    cacheMocks.select.mockReset();
    cacheMocks.eq.mockReset();
    cacheMocks.maybeSingle.mockReset();
    cacheMocks.upsert.mockReset();
    cacheMocks.select.mockReturnValue({ eq: cacheMocks.eq });
    cacheMocks.eq.mockReturnValue({ maybeSingle: cacheMocks.maybeSingle });
    cacheMocks.from.mockReturnValue({ select: cacheMocks.select, upsert: cacheMocks.upsert });
    cacheMocks.createClient.mockReturnValue({ from: cacheMocks.from });
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ AGENT_SOURCE_CACHE_TTL_SECONDS: "3600" }[key]) } });
  });

  it("returns fresh cached source without fetching network", async () => {
    cacheMocks.maybeSingle.mockResolvedValue({
      data: {
        url: "https://docs.example.com/models",
        content: "cached content",
        title: "Cached",
        freshness: "2026-05-29T00:00:00.000Z",
        fetched_at: new Date().toISOString(),
        scrape_method: "static",
      },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getCachedSource } = await import("../../../supabase/functions/mcp-server/tools/agent/sourceCache");
    const result = await getCachedSource(cacheMocks.createClient(), "https://docs.example.com/models");

    expect(result?.content).toBe("cached content");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
