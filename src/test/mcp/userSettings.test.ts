import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserSettings } from "../../../supabase/functions/mcp-server/auth/userSettings";

const settingsMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  selectedUserIds: [] as string[],
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: settingsMocks.createClient,
}));

describe("getUserSettings", () => {
  beforeEach(() => {
    settingsMocks.selectedUserIds = [];
    settingsMocks.createClient.mockReset();
    settingsMocks.createClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_column: string, userId: string) => {
            settingsMocks.selectedUserIds.push(userId);
            return Promise.resolve({
              data: [{ key: "ai_model", value: `model-for-${userId}` }],
              error: null,
            });
          },
        }),
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

  it("uses a resolved per-user MCP secret user id before default settings", async () => {
    const settings = await getUserSettings(null, "secret-user");

    expect(settings).toEqual({ ai_model: "model-for-secret-user" });
    expect(settingsMocks.selectedUserIds).toEqual(["secret-user"]);
  });
});
