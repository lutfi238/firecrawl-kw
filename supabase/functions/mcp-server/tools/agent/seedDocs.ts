export const AUTHORITATIVE_DOCS: Array<[RegExp, string[]]> = [
  [/anthropic|claude/i, [
    "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    "https://docs.anthropic.com/en/docs/about-claude/pricing",
    "https://platform.claude.com/docs/en/about-claude/models/overview",
  ]],
  [/openai|gpt-?\d|codex/i, [
    "https://platform.openai.com/docs/models",
    "https://platform.openai.com/docs/pricing",
    "https://developers.openai.com/api/docs/models/compare",
    "https://openai.com/api/pricing/",
  ]],
  [/google|gemini/i, [
    "https://ai.google.dev/gemini-api/docs/models",
    "https://ai.google.dev/gemini-api/docs/pricing",
  ]],
  [/deepseek/i, ["https://api-docs.deepseek.com/quick_start/pricing"]],
  [/minimax/i, ["https://platform.minimaxi.com/document/Models"]],
  [/moonshot|kimi/i, ["https://platform.moonshot.ai/docs/pricing/chat"]],
  [/qwen|alibaba/i, [
    "https://qwen.readthedocs.io/en/latest/getting_started/concepts.html",
  ]],
  [/glm|zhipu|z\.ai/i, ["https://docs.z.ai/guides/llm/glm-4.6"]],
  [/xai|grok/i, ["https://docs.x.ai/docs/models"]],
  [/mistral/i, [
    "https://docs.mistral.ai/getting-started/models/models_overview/",
  ]],
];

export function seedUrlsForQuery(query: string): string[] {
  const seeds: string[] = [];
  for (const [pattern, urls] of AUTHORITATIVE_DOCS) {
    if (pattern.test(query)) seeds.push(...urls);
  }
  return seeds;
}
