import { beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: jobMocks.createClient,
}));

describe("agent search fallback chain", () => {
  beforeEach(() => {
    vi.resetModules();
    jobMocks.createClient.mockReset();
    jobMocks.from.mockReset();
    jobMocks.update.mockReset();
    jobMocks.eq.mockReset();
    jobMocks.eq.mockResolvedValue({ error: null });
    jobMocks.update.mockReturnValue({ eq: jobMocks.eq });
    jobMocks.from.mockReturnValue({ update: jobMocks.update });
    jobMocks.createClient.mockReturnValue({ from: jobMocks.from });
  });

  it("calls Brave when DuckDuckGo returns no usable results", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo")) return new Response("<html></html>", { status: 200 });
      if (url.includes("api.search.brave.com")) {
        return Response.json({ web: { results: [{ title: "Anthropic docs", url: "https://docs.anthropic.com/en/docs/about-claude/models/overview", description: "Models overview" }] } });
      }
      if (url.includes("docs.anthropic.com")) {
        return new Response("<html><title>Models</title><p>Claude Opus context window is documented here with detailed model information for reliable synthesis.</p><p>Additional paragraph with enough text to be considered usable article content.</p></html>", { status: 200 });
      }
      return Response.json({ choices: [{ message: { content: "grounded answer" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", BRAVE_SEARCH_API_KEY: "brave" }[key]) } });

    const { processAgentJob } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    await processAgentJob("job-1", { prompt: "random vendor docs", maxSteps: 1 }, { provider: "Test", baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "key" });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("duckduckgo"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api.search.brave.com"), expect.any(Object));
  });

  it("calls Bing when Brave throws", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo")) return new Response("<html></html>", { status: 200 });
      if (url.includes("api.search.brave.com")) throw new Error("brave down");
      if (url.includes("api.bing.microsoft.com")) {
        return Response.json({ webPages: { value: [{ name: "OpenAI docs", url: "https://platform.openai.com/docs/models", snippet: "Models" }] } });
      }
      if (url.includes("platform.openai.com")) {
        return new Response("<html><title>Models</title><p>GPT model context windows are documented here with enough descriptive text for article detection.</p><p>Another paragraph provides additional grounded evidence for synthesis.</p></html>", { status: 200 });
      }
      return Response.json({ choices: [{ message: { content: "grounded answer" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", BRAVE_SEARCH_API_KEY: "brave", BING_SEARCH_API_KEY: "bing" }[key]) } });

    const { processAgentJob } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    await processAgentJob("job-2", { prompt: "random vendor docs", maxSteps: 1 }, { provider: "Test", baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "key" });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api.bing.microsoft.com"), expect.any(Object));
  });

  it("scrapes seed URLs when all search engines fail", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo")) return new Response("", { status: 429 });
      if (url.includes("api.search.brave.com")) throw new Error("brave down");
      if (url.includes("api.bing.microsoft.com")) throw new Error("bing down");
      if (url.includes("docs.anthropic.com")) {
        return new Response("<html><title>Claude models</title><p>Claude model context window documentation includes enough details for grounded source extraction.</p><p>Additional supported paragraph makes this source usable for synthesis.</p></html>", { status: 200 });
      }
      return Response.json({ choices: [{ message: { content: "seed grounded answer" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", BRAVE_SEARCH_API_KEY: "brave", BING_SEARCH_API_KEY: "bing" }[key]) } });

    const { processAgentJob } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    await processAgentJob("job-3", { prompt: "claude opus context window", maxSteps: 1 }, { provider: "Test", baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "key" });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("docs.anthropic.com/en/docs/about-claude/models/overview"), expect.any(Object));
  });
});
