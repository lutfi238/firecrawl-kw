import { describe, expect, it } from "vitest";
import { getToolHandler } from "../../../supabase/functions/mcp-server/tools/registry";

describe("tool registry", () => {
  it("returns an executable handler for a known tool and undefined for a missing tool", async () => {
    const handler = (args: Record<string, unknown>) => Promise.resolve({
      content: [{ type: "text", text: `ok:${String(args.query ?? "")}` }],
    });
    const registry = { search: handler };
    const resolvedHandler = getToolHandler(registry, "search");

    expect(resolvedHandler).toBe(handler);
    await expect(resolvedHandler?.({ query: "test" })).resolves.toEqual({
      content: [{ type: "text", text: "ok:test" }],
    });
    expect(getToolHandler(registry, "missing")).toBeUndefined();
  });
});