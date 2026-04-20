import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function getUserSettings(authHeader: string | null): Promise<Record<string, string>> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !authHeader) return {};

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user } } = await supabase.auth.getUser();
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
    return {};
  }
}