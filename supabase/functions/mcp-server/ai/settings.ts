export interface AiSettings {
  provider?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";

export function getAiSettingsFromMap(
  map: Record<string, string>,
): AiSettings | null {
  if (!map.ai_api_key) return null;
  return {
    provider: map.ai_provider || "OpenAI Compatible",
    baseUrl: map.ai_base_url || "https://api.openai.com/v1",
    apiKey: map.ai_api_key,
    model: map.ai_model || "gpt-4o-mini",
  };
}

export function isGitHubModelsProvider(
  aiSettings: Pick<AiSettings, "provider" | "baseUrl">,
): boolean {
  return (
    aiSettings.provider === "GitHub Models" ||
    aiSettings.baseUrl.replace(/\/+$/, "") === GITHUB_MODELS_BASE_URL
  );
}

export function getChatCompletionsUrl(
  aiSettings: Pick<AiSettings, "baseUrl">,
): string {
  return `${aiSettings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function getAiRequestHeaders(
  aiSettings: AiSettings,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${aiSettings.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer":
      "https://id-preview--4485e6f5-86ea-4999-acd7-7209fb13e21d.lovable.app",
    "X-Title": "Personal Firecrawl MCP",
  };

  if (isGitHubModelsProvider(aiSettings)) {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  }

  return headers;
}
