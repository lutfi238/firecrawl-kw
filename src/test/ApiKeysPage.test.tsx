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

  it("shows only delete as the table action for existing secrets", async () => {
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

    expect(screen.queryByTitle("View details")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete zed/i })).toBeInTheDocument();
    expect(screen.queryByText(/mcp secret details/i)).not.toBeInTheDocument();
  });

  it("renames a newly generated secret from the one-time copy dialog", async () => {
    mcpMocks.callTool
      .mockResolvedValueOnce({
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ keys: [] }) }],
      })
      .mockResolvedValueOnce({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: "key-1",
              name: "Default Secret",
              fullKey: "fc_kw-full-secret",
              key_prefix: "fc_kw-abcdefghijklmnop",
              warning: "Save this MCP secret now. It will not be shown again.",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              keys: [
                {
                  id: "key-1",
                  name: "Default Secret",
                  key_prefix: "fc_kw-abcdefghijklmnop",
                  created_at: "2026-06-01T00:00:00.000Z",
                  last_used_at: null,
                  revoked_at: null,
                },
              ],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ success: true }) }],
      })
      .mockResolvedValueOnce({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              keys: [
                {
                  id: "key-1",
                  name: "Claude Desktop",
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

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<ApiKeysPage />);

    await waitFor(() => {
      expect(screen.getByText("MCP SECRETS")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /generate mcp secret/i }));

    await waitFor(() => {
      expect(screen.getByText("fc_kw-full-secret")).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/secret name/i);
    fireEvent.change(nameInput, { target: { value: "Claude Desktop" } });
    fireEvent.click(screen.getByRole("button", { name: /save name/i }));

    await waitFor(() => {
      expect(mcpMocks.callTool).toHaveBeenCalledWith("api_key_manage", {
        action: "rename",
        keyId: "key-1",
        name: "Claude Desktop",
      });
    });
    expect(screen.getByDisplayValue("Claude Desktop")).toBeInTheDocument();
  });
});
