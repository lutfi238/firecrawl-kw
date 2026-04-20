import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { htmlToMarkdown } from "../scrapers/htmlToMarkdown.ts";
import { extractLinks } from "../scrapers/urlUtils.ts";

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function processCrawlJob(jobId: string, args: Record<string, unknown>) {
  const svc = getServiceClient();
  try {
    await svc.from("mcp_jobs").update({ status: "processing" }).eq("id", jobId);

    const visited = new Set<string>();
    const queue: string[] = [args.url as string];
    const results: Array<{ url: string; title?: string; markdown?: string }> = [];
    const limit = (args.maxPages as number) || 10;

    while (queue.length > 0 && visited.size < limit) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      try {
        const res = await fetch(current, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)" }, redirect: "follow" });
        if (!res.ok) continue;
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : current;
        const entry: { url: string; title?: string; markdown?: string } = { url: current, title };
        if (args.extractContent) entry.markdown = htmlToMarkdown(html);
        results.push(entry);
        for (const link of extractLinks(html, current)) {
          if (!visited.has(link)) queue.push(link);
        }
      } catch { /* skip */ }

      if (visited.size % 3 === 0) {
        await svc.from("mcp_jobs").update({
          output: { progress: `${visited.size}/${limit}`, partial: results.length },
        }).eq("id", jobId);
      }
    }

    await svc.from("mcp_jobs").update({
      status: "completed",
      output: { pages: results, totalCrawled: results.length },
    }).eq("id", jobId);
  } catch (err) {
    await svc.from("mcp_jobs").update({
      status: "failed",
      output: { error: err instanceof Error ? err.message : "Unknown error" },
    }).eq("id", jobId);
  }
}