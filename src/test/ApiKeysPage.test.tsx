import { render, screen, waitFor } from "@testing-library/react";
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
});
