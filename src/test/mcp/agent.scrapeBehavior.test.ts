import { beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: jobMocks.createClient,
}));

describe("agent scrape behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    jobMocks.createClient.mockReset();
  });

  it("extracts freshness from full HTML before truncation", async () => {
    const longBody = `<main>${"Claude context details ".repeat(500)}<p>Last updated 2026-05-29</p></main>`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(longBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { scrapeUrlForAgent } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    const scraped = await scrapeUrlForAgent("https://docs.anthropic.com/en/docs/about-claude/models/overview");

    expect(scraped.freshness?.toISOString()).toBe("2026-05-29T00:00:00.000Z");
  });

  it("retries 403 responses through stealth scrape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(Response.json({
        data: {
          html: {
            html: `<main>${"GPT-5.5 context window and max output specs ".repeat(40)}</main>`,
          },
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { scrapeUrlForAgent } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    const scraped = await scrapeUrlForAgent("https://platform.openai.com/docs/models", {
      renderer_provider: "browserless",
      renderer_secret: "token",
    });

    expect(scraped.scrapeMethod).toBe("stealth");
    expect(scraped.markdown).toContain("GPT-5.5 context window");
  });

  it("refetches Mintlify shells with stealth when freshness is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html><script id="__NEXT_DATA__">{"mintlify":true}</script><main>Anthropic model documentation shell</main></html>', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        data: {
          html: {
            html: `<main>${"Claude Opus model docs ".repeat(40)}<p>Last updated 2026-05-29</p></main>`,
          },
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { scrapeUrlForAgent } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    const scraped = await scrapeUrlForAgent("https://docs.anthropic.com/en/docs/about-claude/models/overview", {
      renderer_provider: "browserless",
      renderer_secret: "token",
    });

    expect(scraped.freshness?.toISOString()).toBe("2026-05-29T00:00:00.000Z");
    expect(scraped.scrapeMethod).toBe("stealth");
  });
});
