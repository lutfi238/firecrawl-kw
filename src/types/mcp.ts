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

export interface AgentKnowledgeMetadata {
  subAgentModel?: string;
  subAgentTrainingCutoff: string;
  evidenceFreshnessMax: string | null;
  evidenceFresherThanModel: boolean;
}

export interface AgentToolOutput {
  synthesis: string | null;
  error?: "NO_GROUNDED_SOURCES" | string;
  groundedness?: "none" | "low" | "medium" | "high";
  knowledgeMetadata?: AgentKnowledgeMetadata;
  evidenceMetrics?: Record<string, number>;
  sources?: Array<Record<string, unknown>>;
  sourcesUsed?: string[];
  diagnostic?: Record<string, unknown>;
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
  source?: string | null;
}

export interface ToolTraceStep {
  tool: string;
  label: string;
  icon: string;
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: string[]; // base64 data URIs
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: ToolCallResult;
  toolTrace?: ToolTraceStep[];
  timestamp: Date;
}
