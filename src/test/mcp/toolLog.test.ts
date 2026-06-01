import { beforeEach, describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: logMocks.createClient,
}));

describe("logToolCall", () => {
  beforeEach(() => {
    vi.resetModules();
    logMocks.createClient.mockReset();
    logMocks.insert.mockReset();
    logMocks.createClient.mockReturnValue({
      from: () => ({
        insert: logMocks.insert.mockResolvedValue({ error: null }),
      }),
    });

    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => {
          const values: Record<string, string> = {
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "service-role",
            SUPABASE_ANON_KEY: "anon",
            MCP_DEFAULT_USER_ID: "default-user",
          };
          return values[key];
        },
      },
    });
  });

  it("logs tool calls against the resolved per-user MCP secret user id", async () => {
    const { logToolCall } = await import(
      "../../../supabase/functions/mcp-server/logging/toolLog"
    );
    const req = new Request("https://example.supabase.co/functions/v1/mcp-server", {
      headers: { "x-mcp-secret": "fc_kw-test" },
    });

    await logToolCall(
      req,
      null,
      {
        tool: "search",
        input: { query: "codex" },
        output: { ok: true },
        status: "success",
        durationMs: 12,
      },
      "secret-user",
    );

    expect(logMocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "secret-user" }),
    );
  });
});
