/**
 * Registry of known vision-capable models per provider.
 * Returns 3-state capability: supported | unsupported | unknown.
 */

export type VisionStatus = "supported" | "unsupported" | "unknown";

export interface VisionCheckResult {
  status: VisionStatus;
  reason?: string;
  /** Legacy compat: true if supported, false if unsupported, true if unknown (permissive) */
  supported: boolean;
}

// Models known to support vision (image input)
const VISION_MODELS: Record<string, RegExp[]> = {
  "https://api.openai.com/v1": [
    /gpt-4o/i, /gpt-4-turbo/i, /gpt-4-vision/i, /o1/i, /o3/i, /o4/i, /gpt-5/i,
  ],
  "https://generativelanguage.googleapis.com": [
    /gemini/i,
  ],
  "https://api.anthropic.com": [
    /claude-3/i, /claude-4/i,
  ],
  "https://api.x.ai/v1": [
    /grok-2/i, /grok-3/i,
  ],
  "https://api.deepseek.com": [
    /deepseek-vl/i, /deepseek-chat/i,
  ],
  "https://openrouter.ai/api/v1": [
    /gpt-4o/i, /gemini/i, /claude-3/i, /claude-4/i, /llava/i, /pixtral/i,
    /qwen.*vl/i, /internvl/i, /grok/i, /gpt-5/i,
  ],
  "https://api.groq.com": [
    /llava/i, /llama-3\.2.*vision/i,
  ],
  "https://api.together.xyz/v1": [
    /llava/i, /qwen.*vl/i,
  ],
  "https://api.mistral.ai/v1": [
    /pixtral/i,
  ],
  "https://dashscope-intl.aliyuncs.com": [
    /qwen.*vl/i,
  ],
};

const ALWAYS_VISION_PROVIDERS = [
  "https://generativelanguage.googleapis.com",
];

const NEVER_VISION_PROVIDERS = [
  "https://api.perplexity.ai",
  "https://api.cohere.ai",
  "http://localhost:11434",
];

// Session-based overrides: provider+model combos the user has approved
const sessionOverrides = new Set<string>();

function overrideKey(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, "").toLowerCase()}::${model.toLowerCase()}`;
}

/** Mark a provider+model as user-verified for this session */
export function addVisionOverride(baseUrl: string, model: string): void {
  const key = overrideKey(baseUrl, model);
  sessionOverrides.add(key);
  // Also persist to localStorage for cross-session memory
  try {
    const stored = JSON.parse(localStorage.getItem("vision_overrides") || "[]") as string[];
    if (!stored.includes(key)) {
      stored.push(key);
      localStorage.setItem("vision_overrides", JSON.stringify(stored));
    }
  } catch { /* ignore */ }
}

/** Mark a provider+model as auto-verified after successful image request */
export function confirmVisionWorked(baseUrl: string, model: string): void {
  addVisionOverride(baseUrl, model);
}

function hasOverride(baseUrl: string, model: string): boolean {
  const key = overrideKey(baseUrl, model);
  if (sessionOverrides.has(key)) return true;
  try {
    const stored = JSON.parse(localStorage.getItem("vision_overrides") || "[]") as string[];
    if (stored.includes(key)) {
      sessionOverrides.add(key); // hydrate into session
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Check if the given provider + model combination supports vision/image input.
 */
export function checkVisionSupport(baseUrl: string, model: string): VisionCheckResult {
  if (!baseUrl || !model) {
    return { status: "unsupported", supported: false, reason: "AI provider not configured" };
  }

  // Check user overrides first
  if (hasOverride(baseUrl, model)) {
    return { status: "supported", supported: true, reason: "Previously verified by user" };
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, "").toLowerCase();

  // Hard unsupported
  for (const nv of NEVER_VISION_PROVIDERS) {
    if (normalizedUrl.startsWith(nv.toLowerCase())) {
      return {
        status: "unsupported",
        supported: false,
        reason: `${getProviderName(baseUrl)} does not support image input`,
      };
    }
  }

  // Always supported
  for (const av of ALWAYS_VISION_PROVIDERS) {
    if (normalizedUrl.includes(av.replace("https://", "").split("/")[0])) {
      return { status: "supported", supported: true };
    }
  }

  // Known provider, check model patterns
  for (const [urlPrefix, patterns] of Object.entries(VISION_MODELS)) {
    const prefix = urlPrefix.replace("https://", "").split("/")[0];
    if (normalizedUrl.includes(prefix)) {
      const isVision = patterns.some(p => p.test(model));
      if (isVision) return { status: "supported", supported: true };
      // Known provider but unrecognized model → unknown (not hard block)
      return {
        status: "unknown",
        supported: true,
        reason: `Model "${model}" is not in the verified vision registry. It may still work.`,
      };
    }
  }

  // Completely unknown provider → unknown
  return {
    status: "unknown",
    supported: true,
    reason: "This provider is not in the verified registry. Image support is not confirmed.",
  };
}

function getProviderName(baseUrl: string): string {
  if (baseUrl.includes("perplexity")) return "Perplexity";
  if (baseUrl.includes("cohere")) return "Cohere";
  if (baseUrl.includes("localhost")) return "Ollama";
  return "This provider";
}
