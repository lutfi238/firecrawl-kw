const REJECTED_HOSTS = [
  "news.google.com",
  "google.com",
  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "gstatic.com",
  "googleapis.com",
  "ggpht.com",
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "cloudfront.net",
  "cdn.ampproject.org",
  "amp.dev",
];

const REJECTED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".webm",
  ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot",
  ".css", ".js", ".json", ".xml",
];

export function isGoogleNewsRssWrapper(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "news.google.com" && u.pathname.includes("/rss/articles/");
  } catch {
    return false;
  }
}

export function isValidArticleUrl(candidate: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(candidate);

    if (!parsed.protocol.startsWith("http")) {
      return { valid: false, reason: "non-http protocol" };
    }

    const host = parsed.hostname.toLowerCase();
    for (const rejected of REJECTED_HOSTS) {
      if (host === rejected || host.endsWith("." + rejected)) {
        return { valid: false, reason: `rejected host: ${host}` };
      }
    }

    const pathLower = parsed.pathname.toLowerCase();
    for (const ext of REJECTED_EXTENSIONS) {
      if (pathLower.endsWith(ext)) {
        return { valid: false, reason: `asset extension: ${ext}` };
      }
    }

    if (parsed.pathname.length <= 1 && !parsed.search) {
      return { valid: false, reason: "homepage/root URL" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid URL" };
  }
}

export function normalizeResolvedUrl(candidate: string): string | null {
  const check = isValidArticleUrl(candidate);
  if (!check.valid) {
    console.log("[gnews-resolve] Rejected candidate:", candidate.slice(0, 80), "—", check.reason);
    return null;
  }
  return new URL(candidate).href;
}

export function decodeGoogleNewsToken(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/https?:\/\/[^\s"'<>\\]+/i);
    if (!match) return null;
    return normalizeResolvedUrl(match[0]);
  } catch {
    return null;
  }
}

export async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes("news.google.com")) return url;

  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    const resolved = resp.url ? normalizeResolvedUrl(resp.url) : null;
    if (resolved && !resolved.includes("news.google.com")) return resolved;
  } catch {
    // Fall through to payload decoding.
  }

  const match = url.match(/\/articles\/([^?]+)/);
  if (match) {
    const decoded = decodeGoogleNewsToken(match[1]);
    if (decoded) return decoded;
  }

  throw new Error(`Cannot resolve Google News wrapper: ${url}`);
}

export function decodeEscapedUrl(value: string): string {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\\//g, "/");
}