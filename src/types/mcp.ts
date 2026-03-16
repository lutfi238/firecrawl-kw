export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ToolCallResult {
  content: Array<{
    type: "text" | "image";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface McpLogEntry {
  id: string;
  user_id: string;
  tool: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: ToolCallResult;
  timestamp: Date;
}
