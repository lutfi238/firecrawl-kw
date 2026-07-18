import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMcpAuth } from "../../../supabase/functions/mcp-server/auth/mcpSecret";

const authMocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  validateBearer: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("../../../supabase/functions/mcp-server/auth/apiKey", () => ({
  isApiKey: (value: string) => value.startsWith("fc_kw-") || value.startsWith("fc_sk-"),
  verifyApiKey: authMocks.verifyApiKey,
}));

vi.mock("../../../supabase/functions/mcp-server/auth/oauth", () => ({
  validateBearer: authMocks.validateBearer,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: authMocks.createClient,
}));

const corsHeaders = { "Access-Control-Allow-Origin": "*" };
const resourceMetadataUrl =
  "https://example.supabase.co/functions/v1/mcp-server/.well-known/oauth-protected-resource";

describe("MCP handler authentication", () => {
  beforeEach(() => {
    authMocks.verifyApiKey.mockReset();
    authMocks.validateBearer.mockReset();
    authMocks.createClient.mockReset();
    authMocks.validateBearer.mockResolvedValue({ ok: false });
    authMocks.createClient.mockReturnValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    });
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) =>
          ({
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_ANON_KEY: "anon",
          })[key],
      },
    });
  });

  it("rejects requests without credentials and advertises OAuth metadata", async () => {
    const response = await checkMcpAuth(
      { headers: new Headers() },
      corsHeaders,
      resourceMetadataUrl,
    );

    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toContain(resourceMetadataUrl);
  });

  it("accepts a valid per-user MCP secret", async () => {
    authMocks.verifyApiKey.mockResolvedValue({ userId: "user-1", keyId: "key-1" });

    await expect(
      checkMcpAuth(
        { headers: new Headers({ "x-mcp-secret": "fc_kw-valid" }) },
        corsHeaders,
        resourceMetadataUrl,
      ),
    ).resolves.toBeNull();
  });

  it("accepts an OAuth bearer and rejects an invalid bearer", async () => {
    authMocks.validateBearer.mockResolvedValueOnce({ ok: true, client_id: "client-1" });
    await expect(
      checkMcpAuth(
        { headers: new Headers({ authorization: "Bearer oauth-token" }) },
        corsHeaders,
        resourceMetadataUrl,
      ),
    ).resolves.toBeNull();

    const rejected = await checkMcpAuth(
      { headers: new Headers({ authorization: "Bearer invalid-token" }) },
      corsHeaders,
      resourceMetadataUrl,
    );
    expect(rejected?.status).toBe(401);
  });
});
