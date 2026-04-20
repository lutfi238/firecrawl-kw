export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function getAiSettingsFromMap(map: Record<string, string>): AiSettings | null {
  if (!map.ai_api_key) return null;
  return {
    baseUrl: map.ai_base_url || "https://api.openai.com/v1",
    apiKey: map.ai_api_key,
    model: map.ai_model || "gpt-4o-mini",
  };
}
