import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateBearer } from "./oauth.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

async function getSettingsForUserId(
  userId: string,
): Promise<Record<string, string>> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return {};

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .eq("user_id", userId);

  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data) map[row.key] = row.value ?? "";
  return map;
}

export async function getUserSettings(
  authHeader: string | null,
  resolvedUserId?: string | null,
): Promise<Record<string, string>> {
  if (resolvedUserId) return getSettingsForUserId(resolvedUserId);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authHeader) {
    const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID");
    return defaultUserId ? getSettingsForUserId(defaultUserId) : {};
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return {};

  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (bearer) {
    const oauth = await validateBearer(bearer);
    if (oauth.ok && oauth.user_id) {
      return getSettingsForUserId(oauth.user_id);
    }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};

    const { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", user.id);

    if (error || !data) return {};

    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value ?? "";
    return map;
  } catch {
    const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID");
    return defaultUserId ? getSettingsForUserId(defaultUserId) : {};
  }

  const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID");
  return defaultUserId ? getSettingsForUserId(defaultUserId) : {};
}
