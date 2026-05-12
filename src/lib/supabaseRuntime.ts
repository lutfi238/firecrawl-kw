import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase as envSupabase } from "@/integrations/supabase/client";
import { getBackendConfig, type BackendConfig } from "@/lib/backendConfig";

let cachedKey = "";
let cachedClient: SupabaseClient<Database> | null = null;

function getCacheKey(config: BackendConfig): string {
  return `${config.mode}:${config.supabaseUrl}:${config.supabaseAnonKey.slice(0, 12)}`;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  const config = getBackendConfig();
  if (config.mode === "env") return envSupabase;

  const key = getCacheKey(config);
  if (cachedClient && cachedKey === key) return cachedClient;

  cachedKey = key;
  cachedClient = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: `firecrawl_kw_auth_${btoa(config.supabaseUrl).replace(/=+$/, "")}`,
    },
  });

  return cachedClient;
}

export function getMcpEndpoint(): string {
  return getBackendConfig().mcpEndpoint;
}

export function getSupabaseAnonKey(): string {
  return getBackendConfig().supabaseAnonKey;
}

export function resetSupabaseClientCache(): void {
  cachedKey = "";
  cachedClient = null;
}
