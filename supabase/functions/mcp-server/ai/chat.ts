import {
  getAiRequestHeaders,
  getChatCompletionsUrl,
  type AiSettings,
} from "./settings.ts";
import { createJob, processBatchScrapeJob } from "../jobs/batchScrape.ts";
import { processAgentJob } from "../jobs/agentJobs.ts";
import { processCrawlJob } from "../jobs/crawlJobs.ts";
import { checkJobStatus } from "../jobs/jobStatus.ts";
import { detectSearchRecencyProfile } from "../search/recency.ts";
import {
  isUsableArticleContent,
  scrapeUrl,
  searchWeb,
} from "../scrapers/webSearch.ts";

export type ChatIntent =
  | "casual"
  | "factual"
  | "ranking"
  | "url_scrape"
  | "multi_url"
  | "crawl_request"
  | "extract_request"
  | "deep_research"
  | "job_status";

export function classifyChatIntent(message: string): ChatIntent {
  const msg = message.trim();
  const lower = msg.toLowerCase();

  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      msg,
    )
  ) {
    return "job_status";
  }

  const urls = msg.match(/https?:\/\/[^\s,]+/g);
  if (urls && urls.length > 1) return "multi_url";
  if (urls && urls.length === 1 && msg.split(/\s+/).length <= 10)
    return "url_scrape";
  if (/\b(crawl|map|sitemap|all pages|spider)\b/i.test(lower))
    return "crawl_request";
  if (/\b(extract)\b/i.test(lower) && urls && urls.length >= 1)
    return "extract_request";
  if (
    /\b(research|in-depth|comprehensive|analyze|deep dive|investigate)\b/i.test(
      lower,
    ) &&
    lower.length > 40
  )
    return "deep_research";

  if (
    /\btop\s*\d+/i.test(lower) ||
    /\bbest\b/i.test(lower) ||
    /\branking\b/i.test(lower) ||
    /\branked\b/i.test(lower) ||
    /\bcompare\b/i.test(lower) ||
    /\bcomparison\b/i.test(lower) ||
    /\balternatives?\b/i.test(lower) ||
    /\bvs\.?\b/i.test(lower) ||
    /\bleaderboard\b/i.test(lower) ||
    /\bworst\b/i.test(lower)
  ) {
    return "ranking";
  }

  if (
    /\b(what|who|when|where|why|how|which|is|are|was|were|did|does|do|can|could|will|should)\b/i.test(
      lower,
    ) ||
    /\b(latest|current|recent|new|2024|2025|2026|today|yesterday|this week|this month)\b/i.test(
      lower,
    ) ||
    /\?$/.test(msg.trim())
  ) {
    return "factual";
  }

  if (
    lower.length < 30 ||
    /^(hi|hello|hey|thanks|thank you|ok|sure|cool|great|bye|good morning|good night)/i.test(
      lower,
    )
  ) {
    return "casual";
  }

  return "factual";
}

function chatSearchEvidenceHasDepth(evidence: string): boolean {
  const stripped = evidence
    .split("\n")
    .filter(
      (line: string) =>
        !line.match(
          /^\s*"?(title|url|sourceUrl|snippet|rawDesc|acquisitionType|searchSource)"?\s*:/,
        ) && !line.match(/^\s*[[]{}],?\s*$/),
    )
    .join(" ")
    .trim();
  return stripped.length > 2000;
}

export function buildHistoryContext(
  history: Array<{ role: string; content: string }>,
  current: string,
): string {
  if (history.length === 0) return current;
  const ctx = history
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  return `Previous conversation:\n${ctx}\n\nCurrent message: ${current}`;
}

export function buildMultimodalContent(
  text: string,
  images?: string[],
):
  | string
  | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!images || images.length === 0) return text;
  const parts: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img } });
  }
  parts.push({ type: "text", text });
  return parts;
}

export async function callAI(
  aiSettings: AiSettings,
  systemPrompt: string,
  userContent:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>,
  maxTokens = 4096,
): Promise<string> {
  const userMessage =
    typeof userContent === "string"
      ? { role: "user", content: userContent }
      : { role: "user", content: userContent };
  const res = await fetch(getChatCompletionsUrl(aiSettings), {
    method: "POST",
    headers: getAiRequestHeaders(aiSettings),
    body: JSON.stringify({
      model: aiSettings.model,
      messages: [{ role: "system", content: systemPrompt }, userMessage],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export function callAIStream(
  aiSettings: AiSettings,
  systemPrompt: string,
  userContent:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>,
  maxTokens = 4096,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const userMessage =
    typeof userContent === "string"
      ? { role: "user", content: userContent }
      : { role: "user", content: userContent };

  return new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(getChatCompletionsUrl(aiSettings), {
          method: "POST",
          headers: getAiRequestHeaders(aiSettings),
          body: JSON.stringify({
            model: aiSettings.model,
            messages: [{ role: "system", content: systemPrompt }, userMessage],
            max_tokens: maxTokens,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: `AI API error ${res.status}: ${errText.slice(0, 300)}` })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === "data: [DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
                  );
                }
              } catch {
                // skip malformed
              }
            }
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Stream error" })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

function isHeavyChatIntent(intent: ChatIntent): boolean {
  return intent === "ranking" || intent === "deep_research";
}

export async function handleChatWithOrchestration(
  args: Record<string, unknown>,
  aiSettings: AiSettings,
  authHeader: string | null,
): Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}> {
  const message = (args.message as string) || "";
  const history =
    (args.history as Array<{ role: string; content: string }>) || [];
  const mode = (args.mode as string) || "orchestrate";
  const images = (args.images as string[]) || [];

  if (mode === "synthesis") {
    console.log(
      "[chat] Synthesis bypass mode — direct LLM call, no orchestration",
    );
    const systemPrompt =
      history.find((entry) => entry.role === "system")?.content ||
      "You are a helpful assistant.";
    const nonSystemHistory = history.filter((entry) => entry.role !== "system");
    const userContent = buildMultimodalContent(
      buildHistoryContext(nonSystemHistory, message),
      images,
    );
    const answer = await callAI(aiSettings, systemPrompt, userContent, 4096);
    return { content: [{ type: "text", text: answer }] };
  }

  const intent = classifyChatIntent(message);
  console.log(
    "[chat-orchestrator] Message:",
    message.slice(0, 100),
    "| Intent:",
    intent,
    "| Mode:",
    isHeavyChatIntent(intent) ? "async" : "sync",
  );

  if (images.length > 0) {
    console.log(
      "[chat-orchestrator] Images attached — using direct multimodal LLM",
    );
    const userContent = buildMultimodalContent(
      buildHistoryContext(history, message),
      images,
    );
    const answer = await callAI(
      aiSettings,
      "You are a helpful AI assistant. The user has sent images. Analyze the images carefully and respond to their message. If no text accompanies the images, describe what you see.",
      userContent,
    );
    return { content: [{ type: "text", text: answer }] };
  }

  const steps: string[] = [];
  const addStep = (step: string) => {
    steps.push(step);
    console.log("[chat-orchestrator]", step);
  };

  try {
    if (intent === "casual") {
      addStep("Intent: casual — direct LLM response");
      const answer = await callAI(
        aiSettings,
        "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully.",
        buildHistoryContext(history, message),
      );
      return { content: [{ type: "text", text: answer }] };
    }

    if (intent === "job_status") {
      const jobIdMatch = message.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      if (jobIdMatch) {
        addStep("Intent: job_status — checking job " + jobIdMatch[0]);
        const status = await checkJobStatus(authHeader, jobIdMatch[0]);
        return {
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        };
      }
    }

    if (intent === "url_scrape") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: url_scrape — scraping " + urlMatch[0]);
        try {
          const { markdown, title } = await scrapeUrl(urlMatch[0]);
          return {
            content: [{ type: "text", text: `# ${title}\n\n${markdown}` }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to scrape ${urlMatch[0]}: ${error instanceof Error ? error.message : "unknown"}`,
              },
            ],
            isError: true,
          };
        }
      }
    }

    if (intent === "multi_url") {
      const urls = message.match(/https?:\/\/[^\s,]+/g) || [];
      addStep("Intent: multi_url — batch scraping " + urls.length + " URLs");
      const job = await createJob(authHeader, "batch_scrape", {
        urls: urls.join(", "),
      });
      if (job.error) {
        return {
          content: [
            { type: "text", text: `Error creating batch job: ${job.error}` },
          ],
          isError: true,
        };
      }
      EdgeRuntime.waitUntil(
        processBatchScrapeJob(job.jobId, { urls: urls.join(", ") }),
      );
      return {
        content: [
          {
            type: "text",
            text: `Batch scrape started for ${urls.length} URLs.\n\nJob ID: ${job.jobId}\n\nUse \`check_batch_status\` or send the job ID to check results.`,
          },
        ],
      };
    }

    if (intent === "crawl_request") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: crawl — starting crawl for " + urlMatch[0]);
        const job = await createJob(authHeader, "crawl", {
          url: urlMatch[0],
          maxPages: 10,
          extractContent: true,
        });
        if (job.error) {
          return {
            content: [
              { type: "text", text: `Error creating crawl job: ${job.error}` },
            ],
            isError: true,
          };
        }
        EdgeRuntime.waitUntil(
          processCrawlJob(job.jobId, {
            url: urlMatch[0],
            maxPages: 10,
            extractContent: true,
          }),
        );
        return {
          content: [
            {
              type: "text",
              text: `Crawl started for ${urlMatch[0]}.\n\nJob ID: ${job.jobId}\n\nUse \`check_crawl_status\` or send the job ID to check results.`,
            },
          ],
        };
      }
    }

    if (intent === "extract_request") {
      const urlMatch = message.match(/https?:\/\/[^\s,]+/);
      if (urlMatch) {
        addStep("Intent: extract — extracting from " + urlMatch[0]);
        try {
          const { markdown } = await scrapeUrl(urlMatch[0]);
          const truncated = markdown.slice(0, 12000);
          const answer = await callAI(
            aiSettings,
            "Extract the requested data from the web page content. Return structured information.",
            `User request: ${message}\n\n---PAGE CONTENT---\n${truncated}`,
          );
          return { content: [{ type: "text", text: answer }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to extract from ${urlMatch[0]}: ${error instanceof Error ? error.message : "unknown"}`,
              },
            ],
            isError: true,
          };
        }
      }
    }

    if (isHeavyChatIntent(intent)) {
      addStep(`Intent: ${intent} — delegating to async agent job`);
      const job = await createJob(authHeader, "agent", {
        prompt: message,
        maxSteps: 5,
      });
      if (job.error) {
        return {
          content: [
            { type: "text", text: `Error creating research job: ${job.error}` },
          ],
          isError: true,
        };
      }
      EdgeRuntime.waitUntil(
        processAgentJob(
          job.jobId,
          { prompt: message, maxSteps: 5 },
          aiSettings,
        ),
      );

      const modeLabel =
        intent === "ranking" ? "ranking/comparison research" : "deep research";
      return {
        content: [
          {
            type: "text",
            text: [
              `🔬 **${modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)} started** (async)`,
              "",
              "This query requires multi-source evidence collection and synthesis, which would exceed the sync timeout. It has been delegated to the async research agent.",
              "",
              `**Job ID:** \`${job.jobId}\``,
              "",
              "Check progress with the `agent_status` tool using this job ID, or paste the job ID in chat.",
            ].join("\n"),
          },
        ],
      };
    }

    addStep("Intent: factual — lightweight sync search + synthesis");

    const recencyProfile = detectSearchRecencyProfile(message);
    const searchResults = await searchWeb(message, 5);
    const freshnessSummary = searchResults.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      matchedYear: result.matchedYear,
      freshnessScore: result.freshnessScore,
    }));
    const searchEvidence = JSON.stringify(freshnessSummary, null, 2);
    addStep(`Search returned ${searchResults.length} results`);

    let combinedEvidence = searchEvidence;
    if (
      !chatSearchEvidenceHasDepth(searchEvidence) &&
      searchResults.length > 0
    ) {
      const top = searchResults.find(
        (result) => result.acquisitionType !== "unresolved_wrapper",
      );
      if (top) {
        try {
          addStep(
            `Snippets thin — scraping top result: ${top.url.slice(0, 60)}`,
          );
          const { markdown, title } = await scrapeUrl(top.url);
          if (isUsableArticleContent(markdown)) {
            combinedEvidence = `# ${title}\nSource: ${top.url}\n\n${markdown.slice(0, 4000)}\n\n---\n\nAdditional search results:\n${searchEvidence}`;
            addStep("Scraped 1 supporting article");
          }
        } catch {
          addStep("Single scrape failed — using snippets only");
        }
      }
    }

    addStep("Synthesizing from evidence");
    const synthesisRules = [
      "You are a research assistant that answers ONLY from the provided evidence.",
      "RULES:",
      "1. Base your answer ONLY on the evidence below. Do NOT use background knowledge.",
      "2. If evidence is insufficient, say so. Do not invent.",
      "3. Cite sources by title or URL.",
      "4. Be concise — this is a quick factual answer, not a research report.",
      "5. Include relevant source URLs at the end.",
      recencyProfile.mode !== "none"
        ? "6. This is a recency-sensitive query. Make freshness explicit and do not present older coverage as current when newer coverage is missing."
        : "6. If the evidence looks stale, disclose that clearly.",
      recencyProfile.mode === "future"
        ? "7. Distinguish confirmed upcoming items from speculative predictions."
        : "7. If the evidence is stale relative to the question, say so explicitly.",
    ];

    const answer = await callAI(
      aiSettings,
      synthesisRules.join("\n"),
      `Question: ${message}\n\n---EVIDENCE---\n\n${combinedEvidence}`,
      2048,
    );

    return { content: [{ type: "text", text: answer }] };
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : "Unknown orchestration error";
    console.error("[chat-orchestrator] Error:", errMsg);
    return {
      content: [
        { type: "text", text: `Error during chat orchestration: ${errMsg}` },
      ],
      isError: true,
    };
  }
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
