import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateBearer } from "../auth/oauth.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

async function getUserIdFromAuth(
  authHeader: string | null,
  resolvedUserId?: string | null,
): Promise<string | null> {
  if (resolvedUserId) return resolvedUserId;

  const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID") || null;
  if (!authHeader) return defaultUserId;

  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (bearer) {
    const oauth = await validateBearer(bearer);
    if (oauth.ok && oauth.user_id) return oauth.user_id;
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return defaultUserId;

  try {
    const sb = createClient(url, key, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? defaultUserId;
  } catch {
    return defaultUserId;
  }
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function checkJobStatus(
  authHeader: string | null,
  jobId: string,
  resolvedUserId?: string | null,
): Promise<Record<string, unknown>> {
  const userId = await getUserIdFromAuth(authHeader, resolvedUserId);
  if (!userId) return { error: "Not authenticated" };

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("mcp_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Job not found" };

  return {
    jobId: data.id,
    type: data.type,
    status: data.status,
    ...((data.output as Record<string, unknown>) || {}),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
