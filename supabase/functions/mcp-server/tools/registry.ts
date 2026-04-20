export interface ToolCallResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => ToolCallResult | Promise<ToolCallResult>;

export function getToolHandler(registry: Record<string, ToolHandler>, toolName: string): ToolHandler | undefined {
  return registry[toolName];
}