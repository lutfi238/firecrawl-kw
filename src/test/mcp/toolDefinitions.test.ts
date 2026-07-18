import { describe, expect, it } from "vitest";
import { getToolDefinitions, getToolDefinitionCount } from "../../../supabase/functions/mcp-server/tools/definitions";

describe("MCP tool definitions", () => {
  it("reports the complete backend registry including API key management", () => {
    const definitions = getToolDefinitions({}, null);
    const names = definitions.map((definition) => definition.name);

    expect(getToolDefinitionCount()).toBe(21);
    expect(definitions).toHaveLength(21);
    expect(names.filter((name) => name === "api_key_manage")).toHaveLength(1);
    expect(new Set(names).size).toBe(definitions.length);
  });
});
