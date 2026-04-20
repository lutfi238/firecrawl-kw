export function createJsonRpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function createJsonRpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}