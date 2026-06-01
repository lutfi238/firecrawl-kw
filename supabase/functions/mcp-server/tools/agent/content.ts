export interface MarkdownSource {
  markdown: string;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

export function isThinSpaShell(html: string, url: string): boolean {
  const article = html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if ((!article || stripHtml(article[2]).trim().length < 800) && /\/docs?\//i.test(url)) {
    return true;
  }

  const linkText = (html.match(/<a[^>]*>([^<]*)<\/a>/gi) ?? [])
    .map((tag) => stripHtml(tag))
    .join("").length;
  const totalText = stripHtml(html).length;
  if (totalText > 0 && linkText / totalText > 0.6) return true;

  return /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);
}

export function contentHash(text: string): string {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .toLowerCase()
    .slice(0, 2000);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function dedupeSourcesByContent<T extends MarkdownSource>(sources: T[]): T[] {
  const seen: Record<string, true> = {};
  const deduped: T[] = [];
  for (const source of sources) {
    if (!source.markdown.trim()) {
      deduped.push(source);
      continue;
    }
    const hash = contentHash(source.markdown);
    if (seen[hash]) continue;
    seen[hash] = true;
    deduped.push(source);
  }
  return deduped;
}

export interface UrlMarkdownSource extends MarkdownSource {
  finalUrl?: string;
}

export function dedupeSourcesPreservingSeeds<T extends UrlMarkdownSource>(
  sources: T[],
  seedUrls: string[],
): T[] {
  const seedSet: Record<string, true> = {};
  for (const url of seedUrls) seedSet[url] = true;

  const seen: Record<string, true> = {};
  const deduped: T[] = [];
  for (const source of sources) {
    if (source.finalUrl && seedSet[source.finalUrl]) {
      deduped.push(source);
      continue;
    }
    if (!source.markdown.trim()) {
      deduped.push(source);
      continue;
    }
    const hash = contentHash(source.markdown);
    if (seen[hash]) continue;
    seen[hash] = true;
    deduped.push(source);
  }
  return deduped;
}

export function smartTruncate(text: string, maxChars: number, query: string): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;

  const keywords = query
    .split(/\s+/)
    .map((word) => word.replace(/[^\w-]/g, ""))
    .filter((word) => word.length > 3)
    .slice(0, 5);
  const lower = text.toLowerCase();
  let bestIdx = 0;
  let bestScore = 0;

  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx < 0) continue;
    const window = lower.slice(idx, idx + maxChars);
    const score = keywords.filter((candidate) =>
      window.includes(candidate.toLowerCase())
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  const start = Math.max(0, bestIdx - 200);
  return text.slice(start, start + maxChars);
}

export function relevanceScore(text: string, query: string): number {
  const keywords = query
    .split(/\s+/)
    .map((word) => word.replace(/[^\w-]/g, "").toLowerCase())
    .filter((word) => word.length > 3)
    .slice(0, 8);
  if (keywords.length === 0) return 0;

  const lower = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    let index = lower.indexOf(keyword);
    while (index >= 0) {
      hits += 1;
      index = lower.indexOf(keyword, index + keyword.length);
    }
  }
  return hits / Math.max(1, lower.length / 1000);
}

export function rankAndTruncateSources<T extends MarkdownSource>(
  sources: T[],
  budgetChars: number,
  query: string,
): T[] {
  const minPerSource = 3000;
  const maxSources = Math.max(1, Math.floor(budgetChars / minPerSource));
  return [...sources]
    .sort((a, b) => relevanceScore(b.markdown, query) - relevanceScore(a.markdown, query))
    .slice(0, maxSources)
    .map((source) => {
      const markdown = smartTruncate(source.markdown, Math.max(minPerSource, Math.floor(budgetChars / maxSources)), query);
      return { ...source, markdown };
    });
}
