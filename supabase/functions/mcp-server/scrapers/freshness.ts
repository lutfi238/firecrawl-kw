function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function findMetaDate(html: string): Date | null {
  const metaPatterns = [
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+name=["']last-modified["'][^>]+content=["']([^"']+)/i,
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    const date = parseDate(match?.[1]);
    if (date) return date;
  }
  return null;
}

function findJsonLdDate(html: string): Date | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        const obj = value as Record<string, unknown>;
        const candidate = obj.dateModified ?? obj.datePublished;
        const date = parseDate(typeof candidate === "string" ? candidate : null);
        if (date) return date;
      }
    } catch {
      // Ignore malformed JSON-LD and try the next script.
    }
  }
  return null;
}

export function extractFreshness(html: string, headers: Headers): Date | null {
  const headerDate = parseDate(headers.get("last-modified"));
  if (headerDate) return headerDate;

  const metaDate = findMetaDate(html);
  if (metaDate) return metaDate;

  const jsonLdDate = findJsonLdDate(html);
  if (jsonLdDate) return jsonLdDate;

  const timeTag = html.match(/<time[^>]+datetime=["']([^"']+)/i);
  const timeDate = parseDate(timeTag?.[1]);
  if (timeDate) return timeDate;

  const textStart = html;
  const lastUpdated = textStart.match(
    /(?:last updated|updated|published)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
  );
  const bodyDate = parseDate(lastUpdated?.[1]);
  if (bodyDate) return bodyDate;

  return null;
}
