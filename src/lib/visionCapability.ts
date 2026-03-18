/**
 * Registry of known vision-capable models per provider.
 * Used to check whether the current AI configuration supports multimodal image input.
 */

// Models known to support vision (image input)
const VISION_MODELS: Record<string, RegExp[]> = {
  // OpenAI
  "https://api.openai.com/v1": [
    /gpt-4o/i, /gpt-4-turbo/i, /gpt-4-vision/i, /o1/i, /o3/i, /o4/i, /gpt-5/i,
  ],
  // Google Gemini
  "https://generativelanguage.googleapis.com": [
    /gemini/i, // all Gemini models support vision
  ],
  // Anthropic
  "https://api.anthropic.com": [
    /claude-3/i, /claude-4/i, // Claude 3+ supports vision
  ],
  // Grok (xAI)
  "https://api.x.ai/v1": [
    /grok-2/i, /grok-3/i,
  ],
  // DeepSeek
  "https://api.deepseek.com": [
    /deepseek-vl/i, /deepseek-chat/i, // deepseek-chat v3+ has vision
  ],
  // OpenRouter — many models, allow all by default since it's a router
  "https://openrouter.ai/api/v1": [
    /gpt-4o/i, /gemini/i, /claude-3/i, /claude-4/i, /llava/i, /pixtral/i,
    /qwen.*vl/i, /internvl/i, /grok/i, /gpt-5/i,
  ],
  // Groq
  "https://api.groq.com": [
    /llava/i, /llama-3\.2.*vision/i,
  ],
  // Together AI
  "https://api.together.xyz/v1": [
    /llava/i, /qwen.*vl/i,
  ],
  // Mistral
  "https://api.mistral.ai/v1": [
    /pixtral/i,
  ],
};

// Providers where ALL models are assumed vision-capable
const ALWAYS_VISION_PROVIDERS = [
  "https://generativelanguage.googleapis.com",
];

// Providers that definitely do NOT support vision
const NEVER_VISION_PROVIDERS = [
  "https://api.perplexity.ai",
  "https://api.cohere.ai",
  "http://localhost:11434", // Ollama — depends on model, safer to reject
];

export interface VisionCheckResult {
  supported: boolean;
  reason?: string;
}

/**
 * Check if the given provider + model combination supports vision/image input.
 */
export function checkVisionSupport(baseUrl: string, model: string): VisionCheckResult {
  if (!baseUrl || !model) {
    return { supported: false, reason: "AI provider not configured" };
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, "").toLowerCase();

  // Check never-vision providers
  for (const nv of NEVER_VISION_PROVIDERS) {
    if (normalizedUrl.startsWith(nv.toLowerCase())) {
      return { supported: false, reason: `${getProviderName(baseUrl)} does not support image input` };
    }
  }

  // Check always-vision providers
  for (const av of ALWAYS_VISION_PROVIDERS) {
    if (normalizedUrl.includes(av.replace("https://", "").split("/")[0])) {
      return { supported: true };
    }
  }

  // Check model patterns
  for (const [urlPrefix, patterns] of Object.entries(VISION_MODELS)) {
    const prefix = urlPrefix.replace("https://", "").split("/")[0];
    if (normalizedUrl.includes(prefix)) {
      const isVision = patterns.some(p => p.test(model));
      if (isVision) return { supported: true };
      return {
        supported: false,
        reason: `Model "${model}" may not support image input. Try a vision-capable model.`,
      };
    }
  }

  // Unknown provider — allow but warn
  return { supported: true, reason: "Unknown provider — image support not verified" };
}

function getProviderName(baseUrl: string): string {
  if (baseUrl.includes("perplexity")) return "Perplexity";
  if (baseUrl.includes("cohere")) return "Cohere";
  if (baseUrl.includes("localhost")) return "Ollama";
  return "This provider";
}
