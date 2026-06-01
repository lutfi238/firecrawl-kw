export interface CachedAgentSource {
  content: string;
  title: string;
  freshness: Date | null;
  scrapeMethod: string | null;
  fetchedAt: Date;
}

interface CacheRow {
  content?: string;
  title?: string;
  freshness?: string | null;
  fetched_at?: string;
  scrape_method?: string | null;
}

function cacheTtlMs(): number {
  const seconds = Number(Deno.env.get("AGENT_SOURCE_CACHE_TTL_SECONDS") ?? "3600");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60 * 60 * 1000;
}

export async function getCachedSource(
  svc: { from: (table: string) => unknown },
  url: string,
): Promise<CachedAgentSource | null> {
  try {
    const query = svc.from("agent_source_cache") as {
      select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: CacheRow | null; error: unknown }> } };
    };
    const { data, error } = await query
      .select("url, content, title, freshness, fetched_at, scrape_method")
      .eq("url", url)
      .maybeSingle();
    if (error || !data?.content || !data.fetched_at) return null;

    const fetchedAt = new Date(data.fetched_at);
    if (Number.isNaN(fetchedAt.getTime())) return null;
    if (Date.now() - fetchedAt.getTime() > cacheTtlMs()) return null;

    const freshness = data.freshness ? new Date(data.freshness) : null;
    return {
      content: data.content,
      title: data.title || url,
      freshness: freshness && !Number.isNaN(freshness.getTime()) ? freshness : null,
      scrapeMethod: data.scrape_method || null,
      fetchedAt,
    };
  } catch {
    return null;
  }
}

export async function setCachedSource(
  svc: { from: (table: string) => unknown },
  url: string,
  source: Pick<CachedAgentSource, "content" | "title" | "freshness" | "scrapeMethod">,
): Promise<void> {
  try {
    const table = svc.from("agent_source_cache") as {
      upsert: (row: Record<string, unknown>) => Promise<unknown>;
    };
    await table.upsert({
      url,
      content: source.content,
      title: source.title,
      freshness: source.freshness?.toISOString() ?? null,
      fetched_at: new Date().toISOString(),
      scrape_method: source.scrapeMethod,
    });
  } catch {
    // Cache is opportunistic; never fail an agent run because cache writes fail.
  }
}
