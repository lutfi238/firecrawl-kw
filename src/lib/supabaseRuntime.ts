import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase as envSupabase } from "@/integrations/supabase/client";
import { getBackendConfig } from "@/lib/backendConfig";

export function getSupabaseClient(): SupabaseClient<Database> {
  return envSupabase;
}

export function getMcpEndpoint(): string {
  return getBackendConfig().mcpEndpoint;
}

export function getSupabaseAnonKey(): string {
  return getBackendConfig().supabaseAnonKey;
}

export function resetSupabaseClientCache(): void {
  // No-op: the app now uses the hosted Supabase client from env config only.
}
