export type BackendConfigMode = "env";

export interface BackendConfig {
  mode: BackendConfigMode;
  supabaseUrl: string;
  supabaseAnonKey: string;
  mcpEndpoint: string;
}

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export function deriveMcpEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/mcp-server`;
}

export function getEnvBackendConfig(): BackendConfig {
  return {
    mode: "env",
    supabaseUrl: envSupabaseUrl,
    supabaseAnonKey: envSupabaseAnonKey,
    mcpEndpoint: envSupabaseUrl ? deriveMcpEndpoint(envSupabaseUrl) : "",
  };
}

export function getBackendConfig(): BackendConfig {
  return getEnvBackendConfig();
}

export function hasValidBackendConfig(config = getBackendConfig()): boolean {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.mcpEndpoint) {
    return false;
  }

  try {
    const supabaseUrl = new URL(config.supabaseUrl);
    const mcpUrl = new URL(config.mcpEndpoint);
    return (
      supabaseUrl.protocol.startsWith("http") &&
      mcpUrl.protocol.startsWith("http")
    );
  } catch {
    return false;
  }
}
