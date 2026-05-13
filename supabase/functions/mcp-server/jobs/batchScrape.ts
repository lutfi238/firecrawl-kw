import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scrapeUrl } from "../scrapers/webSearch.ts";
import { validateBearer } from "../auth/oauth.ts";

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getUserIdFromAuth(
  authHeader: string | null,
): Promise<string | null> {
  const defaultUserId = Deno.env.get("MCP_DEFAULT_USER_ID") || null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key || !authHeader) return defaultUserId;

  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (bearer) {
    const oauth = await validateBearer(bearer);
    if (oauth.ok && oauth.user_id) return oauth.user_id;
  }
  const sb = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resolved = await sb.auth
    .getUser()
    .then(({ data }) => data.user?.id ?? null)
    .catch(() => null);
  return resolved ?? defaultUserId;
}

export async function processBatchScrapeJob(
  jobId: string,
  args: Record<string, unknown>,
) {
  const svc = getServiceClient();
  try {
    await svc.from("mcp_jobs").update({ status: "processing" }).eq("id", jobId);

    const urlList = ((args.urls as string) || "")
      .split(",")
      .map((url: string) => url.trim())
      .filter(Boolean);
    const results: Array<{
      url: string;
      title: string;
      markdown: string;
      error?: string;
    }> = [];

    for (const url of urlList) {
      try {
        const { markdown, title } = await scrapeUrl(url);
        results.push({ url, title, markdown: markdown.slice(0, 4000) });
      } catch (error) {
        results.push({
          url,
          title: "Error",
          markdown: "",
          error: error instanceof Error ? error.message : "unknown",
        });
      }

      await svc
        .from("mcp_jobs")
        .update({
          output: {
            progress: `${results.length}/${urlList.length}`,
            partial: results.length,
          },
        })
        .eq("id", jobId);
    }

    await svc
      .from("mcp_jobs")
      .update({
        status: "completed",
        output: {
          results,
          totalScraped: results.filter((result) => !result.error).length,
        },
      })
      .eq("id", jobId);
  } catch (error) {
    await svc
      .from("mcp_jobs")
      .update({
        status: "failed",
        output: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      .eq("id", jobId);
  }
}

export async function createJob(
  authHeader: string | null,
  type: string,
  input: Record<string, unknown>,
): Promise<{ jobId: string; error?: string }> {
  const userId = await getUserIdFromAuth(authHeader);
  if (!userId) return { jobId: "", error: "Not authenticated" };

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("mcp_jobs")
    .insert({ user_id: userId, type, status: "pending", input })
    .select("id")
    .single();

  if (error || !data)
    return { jobId: "", error: error?.message || "Failed to create job" };
  return { jobId: data.id };
}
