const AGGREGATOR_HOSTS: Record<string, true> = {
  "news.google.com": true,
  "msn.com": true,
  "flipboard.com": true,
  "smartnews.com": true,
  "apple.news": true,
};

export function isAggregatorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();

    if (AGGREGATOR_HOSTS[host]) return true;
    if (host === "bing.com" && path.startsWith("/news/")) return true;
    if (host === "yahoo.com" || host === "news.yahoo.com") return true;

    return false;
  } catch {
    return true;
  }
}
