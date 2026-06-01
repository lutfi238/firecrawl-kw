import { beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  outputs: [] as Array<Record<string, unknown>>,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: jobMocks.createClient,
}));

describe("agent no-source safety", () => {
  beforeEach(() => {
    vi.resetModules();
    jobMocks.outputs = [];
    jobMocks.createClient.mockReset();
    jobMocks.from.mockReset();
    jobMocks.update.mockReset();
    jobMocks.eq.mockReset();
    jobMocks.eq.mockResolvedValue({ error: null });
    jobMocks.update.mockImplementation((payload: Record<string, unknown>) => {
      jobMocks.outputs.push(payload);
      return { eq: jobMocks.eq };
    });
    jobMocks.from.mockReturnValue({ update: jobMocks.update });
    jobMocks.createClient.mockReturnValue({ from: jobMocks.from });
  });

  it("returns NO_GROUNDED_SOURCES and does not invoke synthesis LLM", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo")) return new Response("<html></html>", { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" }[key]) } });

    const { processAgentJob } = await import("../../../supabase/functions/mcp-server/jobs/agentJobs");
    await processAgentJob("job-no-sources", { prompt: "specs for the fictional GPT-9 Quantum model", maxSteps: 3 }, { provider: "Test", baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "key" });

    const finalOutput = jobMocks.outputs.find((payload) => payload.status === "completed")?.output as Record<string, unknown>;
    expect(finalOutput).toMatchObject({
      synthesis: null,
      error: "NO_GROUNDED_SOURCES",
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("llm.example"), expect.any(Object));
  });
});
