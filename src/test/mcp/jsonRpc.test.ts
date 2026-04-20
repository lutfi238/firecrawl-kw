import { describe, expect, it } from "vitest";
import { createJsonRpcError, createJsonRpcResult } from "../../../supabase/functions/mcp-server/transport/jsonRpc";

describe("jsonRpc transport helpers", () => {
  it("creates a result payload with the original id", () => {
    expect(createJsonRpcResult(7, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("creates an error payload with the original id", () => {
    expect(createJsonRpcError(7, -32601, "Unknown method")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Unknown method" },
    });
  });
});