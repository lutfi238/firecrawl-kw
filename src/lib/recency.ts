export type RecencyMode = "none" | "recent" | "current_window" | "future";
export type RecencyWindow = "none" | "recent" | "day" | "week" | "month" | "year" | "explicit";

export interface RecencyProfile {
  mode: RecencyMode;
  window: RecencyWindow;
  preferNewsSources: boolean;
  strictFreshness: boolean;
  userSpecifiedYear?: number;
  signals: string[];
}

export interface RuntimeDateHints {
  currentYear: string;
  currentMonthLabel: string;
  nextYear: string;
}

const RECENT_PATTERNS = [
  /\b(latest|newest|recent|current|up[- ]to[- ]date)\b/i,
  /\b(terbaru|terkini|paling baru)\b/i,
  /\b(news|update|updates|release|launch)\b/i,
];

const WINDOW_PATTERNS: Array<{ window: Exclude<RecencyWindow, "none" | "recent" | "explicit">; pattern: RegExp }> = [
  { window: "day", pattern: /\b(today|hari ini)\b/i },
  { window: "week", pattern: /\b(this week|minggu ini)\b/i },
  { window: "month", pattern: /\b(this month|bulan ini)\b/i },
  { window: "year", pattern: /\b(this year|tahun ini)\b/i },
];

const FUTURE_PATTERNS = [
  /\b(upcoming|coming soon|roadmap|planned)\b/i,
  /\b(akan datang|selanjutnya|rencana|tahun depan|next year)\b/i,
];

function detectExplicitYear(text: string): number | undefined {
  const match = text.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function buildMonthLabel(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
}

export function detectRecencyProfile(text: string): RecencyProfile {
  const explicitYear = detectExplicitYear(text);
  const signals: string[] = [];

  const futureMatch = FUTURE_PATTERNS.find((pattern) => pattern.test(text));
  if (futureMatch) {
    signals.push("future");
    return {
      mode: "future",
      window: explicitYear ? "explicit" : "year",
      preferNewsSources: true,
      strictFreshness: false,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  const matchedWindow = WINDOW_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (matchedWindow) {
    signals.push(`window:${matchedWindow.window}`);
    return {
      mode: "current_window",
      window: matchedWindow.window,
      preferNewsSources: true,
      strictFreshness: true,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  const recentMatch = RECENT_PATTERNS.find((pattern) => pattern.test(text));
  if (recentMatch) {
    signals.push("recent");
    return {
      mode: "recent",
      window: explicitYear ? "explicit" : "recent",
      preferNewsSources: true,
      strictFreshness: true,
      userSpecifiedYear: explicitYear,
      signals,
    };
  }

  return {
    mode: "none",
    window: explicitYear ? "explicit" : "none",
    preferNewsSources: false,
    strictFreshness: false,
    userSpecifiedYear: explicitYear,
    signals,
  };
}

export function buildRuntimeDateHints(now = new Date()): RuntimeDateHints {
  const currentYear = String(now.getUTCFullYear());
  return {
    currentYear,
    currentMonthLabel: buildMonthLabel(now),
    nextYear: String(now.getUTCFullYear() + 1),
  };
}