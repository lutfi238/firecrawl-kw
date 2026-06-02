import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeysPage from "@/pages/ApiKeysPage";

const mcpMocks = vi.hoisted(() => ({
  callTool: vi.fn(),
}));

vi.mock("@/hooks/useMCPServer", () => ({
  useMCPServer: () => ({
    callTool: mcpMocks.callTool,
    loading: false,
  }),
}));

describe("ApiKeysPage", () => {
  beforeEach(() => {
    mcpMocks.callTool.mockReset();
    mcpMocks.callTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ keys: [] }) }],
    });
  });

  it("presents per-user API keys as MCP secrets managed from the website", async () => {
    render(<ApiKeysPage />);

    await waitFor(() => {
      expect(screen.getByText("MCP SECRETS")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /generate mcp secret/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/generate your first per-user secret/i),
    ).toBeInTheDocument();
  });

  it("makes clear that detail copy only copies the stored prefix", async () => {
    mcpMocks.callTool.mockResolvedValue({
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            keys: [
              {
                id: "key-1",
                name: "Zed",
                key_prefix: "fc_kw-abcdefghijklmnop",
                created_at: "2026-06-01T00:00:00.000Z",
                last_used_at: null,
                revoked_at: null,
              },
            ],
          }),
        },
      ],
    });

    render(<ApiKeysPage />);

    await waitFor(() => {
      expect(screen.getByText("Zed")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("View details"));

    expect(
      screen.getByText(/only the saved prefix is available/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/secret prefix \(not the full key\)/i),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Copy prefix identifier")).toBeInTheDocument();
    expect(screen.queryByTitle(/show secret/i)).not.toBeInTheDocument();
  });
});
