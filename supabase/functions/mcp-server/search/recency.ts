export type SearchRecencyMode = "none" | "recent" | "current_window" | "future";
export type SearchRecencyWindow = "none" | "recent" | "day" | "week" | "month" | "year" | "explicit";

export interface SearchRecencyProfile {
  mode: SearchRecencyMode;
  window: SearchRecencyWindow;
  preferNewsSources: boolean;
  strictFreshness: boolean;
  userSpecifiedYear?: number;
}

export interface RuntimeDateHints {
  currentYear: string;
  nextYear: string;
  currentMonthLabel: string;
  currentMonthName: string;
}

export interface FreshnessSignals {
  matchedYear?: number;
  relativeFreshness: number;
  sourceBoost: number;
  futureBoost: number;
}

type FreshnessInput = string | {
  title?: string;
  snippet?: string;
  rawDesc?: string;
  content?: string;
  text?: string;
  url?: string;
  sourceUrl?: string;
  searchSource?: string;
  publishedAt?: string | Date;
  pubDate?: string | Date;
  date?: string | Date;
  datePublished?: string | Date;
  date_published?: string | Date;
  updatedAt?: string | Date;
  createdAt?: string | Date;
};

const MONTH_DEFINITIONS = [
  { number: 1, name: "January", token: "jan(?:uary)?" },
  { number: 2, name: "February", token: "feb(?:ruary)?" },
  { number: 3, name: "March", token: "mar(?:ch)?" },
  { number: 4, name: "April", token: "apr(?:il)?" },
  { number: 5, name: "May", token: "may" },
  { number: 6, name: "June", token: "jun(?:e)?" },
  { number: 7, name: "July", token: "jul(?:y)?" },
  { number: 8, name: "August", token: "aug(?:ust)?" },
  { number: 9, name: "September", token: "sep(?:t(?:ember)?)?" },
  { number: 10, name: "October", token: "oct(?:ober)?" },
  { number: 11, name: "November", token: "nov(?:ember)?" },
  { number: 12, name: "December", token: "dec(?:ember)?" },
] as const;

const MONTH_TOKEN_SOURCE = MONTH_DEFINITIONS.map((month) => month.token).join("|");

const RECENT_PATTERNS = [
  /\b(latest|newest|recent|current|up[- ]to[- ]date)\b/i,
  /\b(terbaru|terkini|paling baru)\b/i,
  /\b(news|update|updates|release|launch)\b/i,
];

const WINDOW_PATTERNS: Array<{ window: Exclude<SearchRecencyWindow, "none" | "recent" | "explicit">; pattern: RegExp }> = [
  { window: "day", pattern: /\b(today|hari ini)\b/i },
  { window: "week", pattern: /\b(this week|minggu ini)\b/i },
  { window: "month", pattern: /\b(this month|bulan ini)\b/i },
  { window: "year", pattern: /\b(this year|tahun ini)\b/i },
];

const FUTURE_PATTERNS = [
  /\b(upcoming|coming soon|next|roadmap|planned|preview)\b/i,
  /\b(akan datang|selanjutnya|rencana|tahun depan|next year)\b/i,
];

const TIME_FRESHNESS_PATTERNS = [
  { pattern: /\b(just now|moments ago|minutes ago|hours ago)\b/i, boost: 8 },
  { pattern: /\b(today|earlier today|hari ini)\b/i, boost: 7 },
  { pattern: /\b(yesterday|kemarin)\b/i, boost: 5 },
  { pattern: /\b(this week|minggu ini)\b/i, boost: 6 },
  { pattern: /\b(this month|bulan ini)\b/i, boost: 5 },
  { pattern: /\b(this year|tahun ini)\b/i, boost: 4 },
];

const STALE_FRESHNESS_PATTERNS = [
  { pattern: /\b(last week|minggu lalu)\b/i, penalty: 2 },
  { pattern: /\b(last month|bulan lalu)\b/i, penalty: 3 },
  { pattern: /\b(last year|tahun lalu)\b/i, penalty: 5 },
];

const ISO_DATE_PATTERN = /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/;
const DAY_MONTH_YEAR_PATTERN = new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])(st|nd|rd|th)?\\s+(${MONTH_TOKEN_SOURCE})\\s+(20\\d{2})\\b`, "i");
const MONTH_DAY_YEAR_PATTERN = new RegExp(`\\b(${MONTH_TOKEN_SOURCE})\\s+(0?[1-9]|[12]\\d|3[01])(st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, "i");
const MONTH_YEAR_PATTERN = new RegExp(`\\b(${MONTH_TOKEN_SOURCE})\\s+(20\\d{2})\\b`, "i");

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getRuntimeMonthName(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(now);
}

function getObservedDate(input: FreshnessInput): Date | undefined {
  if (typeof input === "string") return undefined;

  const candidates: Array<string | Date | undefined> = [
    input.publishedAt,
    input.pubDate,
    input.datePublished,
    input.date_published,
    input.updatedAt,
    input.createdAt,
    input.date,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}

function parseDateFromText(text: string): Date | undefined {
  const isoMatch = text.match(ISO_DATE_PATTERN);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const dayMonthMatch = text.match(DAY_MONTH_YEAR_PATTERN);
  if (dayMonthMatch) {
    const monthNumber = getMonthNumber(dayMonthMatch[3]);
    if (monthNumber) {
      return new Date(Date.UTC(Number(dayMonthMatch[4]), monthNumber - 1, Number(dayMonthMatch[1])));
    }
  }

  const monthDayMatch = text.match(MONTH_DAY_YEAR_PATTERN);
  if (monthDayMatch) {
    const monthNumber = getMonthNumber(monthDayMatch[1]);
    if (monthNumber) {
      return new Date(Date.UTC(Number(monthDayMatch[3]), monthNumber - 1, Number(monthDayMatch[2])));
    }
  }

  const monthYearMatch = text.match(MONTH_YEAR_PATTERN);
  if (monthYearMatch) {
    const monthNumber = getMonthNumber(monthYearMatch[1]);
    if (monthNumber) {
      return new Date(Date.UTC(Number(monthYearMatch[2]), monthNumber - 1, 1));
    }
  }

  return undefined;
}

function getMonthNumber(token: string): number | undefined {
  for (const month of MONTH_DEFINITIONS) {
    if (new RegExp(`\\b${month.token}\\b`, "i").test(token)) {
      return month.number;
    }
  }
  return undefined;
}

function buildHaystack(input: FreshnessInput): string {
  if (typeof input === "string") return normalizeText(input);

  const parts: string[] = [];
  for (const key of ["title", "snippet", "rawDesc", "content", "text", "url", "sourceUrl"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      parts.push(value);
    }
  }
  return normalizeText(parts.join(" "));
}

function getSourceBoost(input: FreshnessInput, profile: SearchRecencyProfile): number {
  if (!profile.preferNewsSources || typeof input === "string") return 0;

  const searchSource = (input.searchSource || "").toLowerCase();
  if (searchSource === "google_news_rss" || searchSource === "bing_rss") return 3;
  return 0;
}

export function detectSearchRecencyProfile(text: string): SearchRecencyProfile {
  const lower = text.toLowerCase();
  const explicitYear = Number(text.match(/\b(20\d{2})\b/)?.[1] || "") || undefined;

  if (FUTURE_PATTERNS.some((pattern) => pattern.test(lower))) {
    return { mode: "future", window: explicitYear ? "explicit" : "year", preferNewsSources: true, strictFreshness: false, userSpecifiedYear: explicitYear };
  }

  const matchedWindow = WINDOW_PATTERNS.find(({ pattern }) => pattern.test(lower));
  if (matchedWindow) {
    return { mode: "current_window", window: matchedWindow.window, preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  if (RECENT_PATTERNS.some((pattern) => pattern.test(lower))) {
    return { mode: "recent", window: explicitYear ? "explicit" : "recent", preferNewsSources: true, strictFreshness: true, userSpecifiedYear: explicitYear };
  }

  return { mode: "none", window: explicitYear ? "explicit" : "none", preferNewsSources: false, strictFreshness: false, userSpecifiedYear: explicitYear };
}

export function getRuntimeDateHints(now = new Date()): RuntimeDateHints {
  const currentYear = String(now.getUTCFullYear());
  const currentMonthName = getRuntimeMonthName(now);

  return {
    currentYear,
    nextYear: String(now.getUTCFullYear() + 1),
    currentMonthLabel: `${currentMonthName} ${currentYear}`,
    currentMonthName,
  };
}

export function buildSearchQueryVariants(query: string, profile: SearchRecencyProfile, now = new Date()): string[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const hints = getRuntimeDateHints(now);
  const variants = new Set<string>([normalizedQuery]);

  if (profile.mode === "recent" || profile.mode === "current_window") {
    variants.add(`${normalizedQuery} ${hints.currentMonthLabel}`);
    variants.add(`${normalizedQuery} ${hints.currentYear}`);

    if (profile.preferNewsSources) {
      variants.add(`${normalizedQuery} latest news ${hints.currentYear}`);
    }
  }

  if (profile.mode === "future") {
    variants.add(`${normalizedQuery} upcoming ${hints.currentYear}`);
    variants.add(`${normalizedQuery} roadmap ${hints.currentYear}`);
    variants.add(`${normalizedQuery} ${hints.nextYear}`);
  }

  return [...variants].slice(0, 4);
}

export function extractFreshnessSignals(input: FreshnessInput, profile: SearchRecencyProfile, now = new Date()): FreshnessSignals {
  const haystack = buildHaystack(input);
  const lower = haystack.toLowerCase();
  const currentYear = now.getUTCFullYear();
  const hints = getRuntimeDateHints(now);

  let matchedYear: number | undefined;
  let relativeFreshness = 0;
  let futureBoost = 0;

  const sourceBoost = getSourceBoost(input, profile);

  const observedDate = getObservedDate(input) || parseDateFromText(haystack);
  if (observedDate) {
    matchedYear = observedDate.getUTCFullYear();

    const ageDays = (now.getTime() - observedDate.getTime()) / 86_400_000;
    if (ageDays < 0) {
      futureBoost += 5;
    } else if (ageDays <= 1) {
      relativeFreshness += 8;
    } else if (ageDays <= 7) {
      relativeFreshness += 6;
    } else if (ageDays <= 30) {
      relativeFreshness += 4;
    } else if (ageDays <= 365) {
      relativeFreshness += 2;
    } else if (profile.strictFreshness) {
      relativeFreshness -= ageDays > 730 ? 8 : 4;
    }

    if (observedDate.getUTCFullYear() === currentYear && observedDate.getUTCMonth() === now.getUTCMonth() && observedDate.getUTCDate() === now.getUTCDate()) {
      relativeFreshness += 2;
    }
  } else {
    const yearMatch = haystack.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      matchedYear = Number(yearMatch[1]);
    }

    if (matchedYear === currentYear) {
      relativeFreshness += 5;
    }

    if (matchedYear === currentYear - 1 && profile.strictFreshness) {
      relativeFreshness -= 4;
    }

    if (matchedYear && matchedYear < currentYear - 1 && profile.strictFreshness) {
      relativeFreshness -= 8;
    }

    for (const signal of TIME_FRESHNESS_PATTERNS) {
      if (signal.pattern.test(lower)) {
        relativeFreshness += signal.boost;
      }
    }

    for (const signal of STALE_FRESHNESS_PATTERNS) {
      if (signal.pattern.test(lower) && profile.strictFreshness) {
        relativeFreshness -= signal.penalty;
      }
    }

    if (lower.includes(hints.currentMonthLabel.toLowerCase())) {
      relativeFreshness += 2;
    } else if (lower.includes(hints.currentMonthName.toLowerCase()) && lower.includes(hints.currentYear)) {
      relativeFreshness += 1;
    }
  }

  if (profile.mode === "future" && FUTURE_PATTERNS.some((pattern) => pattern.test(lower))) {
    futureBoost += 4;
  }

  if (profile.mode === "future" && (lower.includes(hints.currentYear) || lower.includes(hints.nextYear))) {
    futureBoost += 1;
  }

  return { matchedYear, relativeFreshness, sourceBoost, futureBoost };
}

export function scoreFreshness(input: FreshnessInput, profile: SearchRecencyProfile, now = new Date()): number {
  if (profile.mode === "none") return 0;

  const signals = extractFreshnessSignals(input, profile, now);
  const score = signals.relativeFreshness + signals.sourceBoost + signals.futureBoost;

  if (score === 0 && profile.strictFreshness) {
    return -1;
  }

  return score;
}
