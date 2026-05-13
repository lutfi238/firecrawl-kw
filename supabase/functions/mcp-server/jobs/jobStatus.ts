import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getUserIdFromAuth(authHeader: string | null): Promise<string | null> {
  const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID") || null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key || !authHeader) return Promise.resolve(defaultUserId);
  const sb = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return sb.auth
    .getUser()
    .then(({ data }) => data.user?.id ?? defaultUserId)
    .catch(() => defaultUserId);
}

export async function checkJobStatus(
  authHeader: string | null,
  jobId: string,
): Promise<Record<string, unknown>> {
  const userId = await getUserIdFromAuth(authHeader);
  if (!userId) return { error: "Not authenticated" };

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb
    .from("mcp_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return { error: "Job not found" };
  return {
    jobId: data.id,
    type: data.type,
    status: data.status,
    ...((data.output as Record<string, unknown>) || {}),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
