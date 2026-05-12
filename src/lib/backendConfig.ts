export type BackendConfigMode = "env" | "custom";

export interface BackendConfig {
  mode: BackendConfigMode;
  supabaseUrl: string;
  supabaseAnonKey: string;
  mcpEndpoint: string;
}

const STORAGE_KEY = "firecrawl_kw_backend_config";
const SETUP_REQUEST_KEY = "firecrawl_kw_backend_setup_requested";

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

export function getStoredBackendConfig(): BackendConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackendConfig>;
    if (parsed.mode !== "custom") return null;
    if (!parsed.supabaseUrl || !parsed.supabaseAnonKey) return null;
    return {
      mode: "custom",
      supabaseUrl: parsed.supabaseUrl,
      supabaseAnonKey: parsed.supabaseAnonKey,
      mcpEndpoint: parsed.mcpEndpoint || deriveMcpEndpoint(parsed.supabaseUrl),
    };
  } catch {
    return null;
  }
}

export function getBackendConfig(): BackendConfig {
  return getStoredBackendConfig() || getEnvBackendConfig();
}

export function isBackendSetupRequested(): boolean {
  return localStorage.getItem(SETUP_REQUEST_KEY) === "true";
}

export function requestBackendSetup(): void {
  localStorage.setItem(SETUP_REQUEST_KEY, "true");
  window.dispatchEvent(new Event("firecrawl-backend-config-changed"));
}

export function clearBackendSetupRequest(): void {
  localStorage.removeItem(SETUP_REQUEST_KEY);
}

export function shouldShowBackendSetup(): boolean {
  return isBackendSetupRequested() || !hasValidBackendConfig();
}

export function hasValidBackendConfig(config = getBackendConfig()): boolean {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.mcpEndpoint)
    return false;
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

export function saveBackendConfig(
  config: Omit<BackendConfig, "mode">,
): BackendConfig {
  const normalized: BackendConfig = {
    mode: "custom",
    supabaseUrl: config.supabaseUrl.replace(/\/+$/, ""),
    supabaseAnonKey: config.supabaseAnonKey.trim(),
    mcpEndpoint: (
      config.mcpEndpoint || deriveMcpEndpoint(config.supabaseUrl)
    ).replace(/\/+$/, ""),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  clearBackendSetupRequest();
  window.dispatchEvent(new Event("firecrawl-backend-config-changed"));
  return normalized;
}

export function clearBackendConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  clearBackendSetupRequest();
  window.dispatchEvent(new Event("firecrawl-backend-config-changed"));
}

export function getBackendConfigStorageKey(): string {
  return STORAGE_KEY;
}
