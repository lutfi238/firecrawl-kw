import {
  buildHistoryContext,
  buildMultimodalContent,
  callAIStream,
  classifyChatIntent,
  handleChatWithOrchestration,
} from "../ai/chat.ts";
import {
  getAiRequestHeaders,
  getAiSettingsFromMap,
  getChatCompletionsUrl,
  isGitHubModelsProvider,
} from "../ai/settings.ts";
import { getUserSettings } from "../auth/userSettings.ts";
import { createJob, processBatchScrapeJob } from "../jobs/batchScrape.ts";
import { processAgentJob } from "../jobs/agentJobs.ts";
import { processCrawlJob } from "../jobs/crawlJobs.ts";
import { checkJobStatus } from "../jobs/jobStatus.ts";
import { htmlToMarkdown } from "../scrapers/htmlToMarkdown.ts";
import { searchWeb, scrapeUrl } from "../scrapers/webSearch.ts";
import { extractLinks } from "../scrapers/urlUtils.ts";
import { getToolHandler, type ToolHandler } from "./registry.ts";

type ToolResult = {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
};

type ToolDispatchOutcome =
  | { kind: "result"; result: ToolResult }
  | { kind: "response"; response: Response }
  | { kind: "unknown-tool" };

type HandleToolCallParams = {
  args: Record<string, unknown>;
  authHeader: string | null;
  corsHeaders: Record<string, string>;
  name: string;
};

const toolRegistry: Record<string, ToolHandler> = {
  search: async (args: Record<string, unknown>) => {
    const results = await searchWeb(
      args.query as string,
      (args.maxResults as number) || 10,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
  scrape: async (args: Record<string, unknown>) => {
    const { markdown, title } = await scrapeUrl(args.url as string);
    return { content: [{ type: "text", text: `# ${title}\n\n${markdown}` }] };
  },
};

const getJobStatusResult = async (
  authHeader: string | null,
  jobId: string,
): Promise<ToolResult> => {
  const status = await checkJobStatus(authHeader, jobId);
  return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
};

const createPendingJobResult = (
  jobId: string,
  message: string,
): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ jobId, status: "pending", message }),
    },
  ],
});

export async function handleToolCall({
  args,
  authHeader,
  corsHeaders,
  name,
}: HandleToolCallParams): Promise<ToolDispatchOutcome> {
  if (name === "scrape_js" || name === "screenshot") {
    const userSettings = await getUserSettings(authHeader);
    const provider = userSettings.renderer_provider || "none";
    const hasRenderer =
      provider === "browserless"
        ? !!userSettings.renderer_secret
        : provider === "custom"
          ? !!userSettings.renderer_url
          : false;

    if (!hasRenderer && name === "screenshot") {
      return {
        kind: "result",
        result: {
          content: [
            {
              type: "text",
              text: "Screenshot requires a JS renderer. Configure Browserless or a custom renderer in Settings.",
            },
          ],
          isError: true,
        },
      };
    }
    // scrape_js will fall back to regular scrape below if no renderer
  }

  const registeredHandler = getToolHandler(toolRegistry, name);
  if (registeredHandler) {
    return { kind: "result", result: await registeredHandler(args) };
  }

  switch (name) {
    case "scrape_js": {
      const userSettings = await getUserSettings(authHeader);
      const provider = userSettings.renderer_provider || "none";

      // ---- Browserless provider (BrowserQL) ----
      if (provider === "browserless") {
        const token = userSettings.renderer_secret || "";
        if (!token) {
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: "Error: Browserless token not configured in Settings.",
                },
              ],
              isError: true,
            },
          };
        }
        const browserlessUrl = (
          userSettings.renderer_url || "https://production-sfo.browserless.io"
        ).replace(/\/+$/, "");
        const waitMs = (args.waitFor as number) || 3000;
        const res = await fetch(
          `${browserlessUrl}/chromium/bql?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `
                mutation ScrapeJS($url: String!, $wait: Float!) {
                  goto(url: $url, waitUntil: networkIdle) {
                    status
                  }
                  waitForTimeout(time: $wait) {
                    time
                  }
                  html {
                    html
                  }
                }
              `,
              variables: {
                url: args.url as string,
                wait: waitMs,
              },
            }),
          },
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: `BrowserQL error ${res.status}: ${errText.slice(0, 300)}`,
                },
              ],
              isError: true,
            },
          };
        }
        const data = await res.json();
        const html = data?.data?.html?.html || "";
        if (!html) {
          const errors =
            data?.errors
              ?.map((e: { message: string }) => e.message)
              .join("; ") || "No HTML returned";
          return {
            kind: "result",
            result: {
              content: [{ type: "text", text: `BrowserQL error: ${errors}` }],
              isError: true,
            },
          };
        }
        return {
          kind: "result",
          result: { content: [{ type: "text", text: htmlToMarkdown(html) }] },
        };
      }

      // ---- Custom renderer provider ----
      if (provider === "custom") {
        const rendererUrl = userSettings.renderer_url;
        if (!rendererUrl) {
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: "Error: Custom renderer URL not configured in Settings.",
                },
              ],
              isError: true,
            },
          };
        }
        const secret = userSettings.renderer_secret || "";
        const res = await fetch(`${rendererUrl}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Secret": secret },
          body: JSON.stringify({
            url: args.url,
            waitFor: args.waitFor || 3000,
          }),
        });
        if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
        const { html } = await res.json();
        return {
          kind: "result",
          result: { content: [{ type: "text", text: htmlToMarkdown(html) }] },
        };
      }

      // ---- Fallback: use regular scrape ----
      const { markdown, title } = await scrapeUrl(args.url as string);
      return {
        kind: "result",
        result: {
          content: [
            {
              type: "text",
              text: `[Fallback: JS renderer not configured, using plain HTTP scrape]\n\n# ${title}\n\n${markdown}`,
            },
          ],
        },
      };
    }

    case "crawl": {
      const job = await createJob(authHeader, "crawl", args);
      if (job.error) {
        return {
          kind: "result",
          result: {
            content: [
              { type: "text", text: `Error creating crawl job: ${job.error}` },
            ],
            isError: true,
          },
        };
      }
      EdgeRuntime.waitUntil(processCrawlJob(job.jobId, args));
      return {
        kind: "result",
        result: createPendingJobResult(
          job.jobId,
          "Crawl started. Use check_crawl_status tool with this jobId to poll for results.",
        ),
      };
    }

    case "map": {
      const visited = new Set<string>();
      const queue: string[] = [args.url as string];
      const limit = (args.maxPages as number) || 50;
      while (queue.length > 0 && visited.size < limit) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        try {
          const res = await fetch(current, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; FirecrawlMCP/1.0)",
            },
            redirect: "follow",
          });
          if (!res.ok) continue;
          const html = await res.text();
          for (const link of extractLinks(html, current)) {
            if (!visited.has(link)) queue.push(link);
          }
        } catch {
          // skip
        }
      }
      return {
        kind: "result",
        result: {
          content: [
            { type: "text", text: JSON.stringify([...visited], null, 2) },
          ],
        },
      };
    }

    case "extract": {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      if (!aiSettings) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key.",
              },
            ],
            isError: true,
          },
        };
      }

      const { markdown } = await scrapeUrl(args.url as string);
      const truncated = markdown.slice(0, 12000);
      const systemPrompt = args.schema
        ? `Extract the requested data from the web page content. Return valid JSON matching this schema: ${args.schema as string}`
        : "Extract the requested data from the web page content. Return structured JSON.";
      const aiRes = await fetch(getChatCompletionsUrl(aiSettings), {
        method: "POST",
        headers: getAiRequestHeaders(aiSettings),
        body: JSON.stringify({
          model: aiSettings.model,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `${args.prompt as string}\n\n---PAGE CONTENT---\n${truncated}`,
            },
          ],
          max_tokens: 4096,
        }),
      });
      const aiBody = await aiRes.text();
      if (!aiRes.ok) {
        let errorMsg = `AI API error ${aiRes.status}`;
        try {
          const errData = JSON.parse(aiBody);
          errorMsg += `: ${errData.error?.message || errData.message || aiBody.slice(0, 300)}`;
        } catch {
          errorMsg += `: ${aiBody.slice(0, 300)}`;
        }
        return {
          kind: "result",
          result: {
            content: [{ type: "text", text: errorMsg }],
            isError: true,
          },
        };
      }

      const aiData = JSON.parse(aiBody);
      const answer = aiData.choices?.[0]?.message?.content;
      if (!answer) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: `AI returned no content. Raw response: ${JSON.stringify(aiData).slice(0, 500)}`,
              },
            ],
            isError: true,
          },
        };
      }
      return {
        kind: "result",
        result: { content: [{ type: "text", text: answer }] },
      };
    }

    case "screenshot": {
      const userSettings = await getUserSettings(authHeader);
      const provider = userSettings.renderer_provider || "none";

      // ---- Browserless provider (BrowserQL) ----
      if (provider === "browserless") {
        const token = userSettings.renderer_secret || "";
        if (!token) {
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: "Error: Browserless token not configured.",
                },
              ],
              isError: true,
            },
          };
        }
        const browserlessUrl = (
          userSettings.renderer_url || "https://production-sfo.browserless.io"
        ).replace(/\/+$/, "");
        const width = (args.width as number) || 1280;
        const height = (args.height as number) || 800;
        const res = await fetch(
          `${browserlessUrl}/chromium/bql?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `
                mutation Screenshot($url: String!, $w: Float!, $h: Float!) {
                  goto(url: $url, waitUntil: networkIdle) {
                    status
                  }
                  viewport(width: $w, height: $h) {
                    width
                    height
                  }
                  screenshot(type: png) {
                    base64
                  }
                }
              `,
              variables: {
                url: args.url as string,
                w: width,
                h: height,
              },
            }),
          },
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: `BrowserQL screenshot error ${res.status}: ${errText.slice(0, 300)}`,
                },
              ],
              isError: true,
            },
          };
        }
        const data = await res.json();
        const base64 = data?.data?.screenshot?.base64 || "";
        if (!base64) {
          const errors =
            data?.errors
              ?.map((e: { message: string }) => e.message)
              .join("; ") || "No screenshot returned";
          return {
            kind: "result",
            result: {
              content: [{ type: "text", text: `BrowserQL error: ${errors}` }],
              isError: true,
            },
          };
        }
        return {
          kind: "result",
          result: {
            content: [{ type: "image", data: base64, mimeType: "image/png" }],
          },
        };
      }

      // ---- Custom renderer provider ----
      if (provider === "custom") {
        const rendererUrl = userSettings.renderer_url;
        if (!rendererUrl) {
          return {
            kind: "result",
            result: {
              content: [
                {
                  type: "text",
                  text: "Error: Custom renderer URL not configured.",
                },
              ],
              isError: true,
            },
          };
        }
        const secret = userSettings.renderer_secret || "";
        const res = await fetch(`${rendererUrl}/screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Secret": secret },
          body: JSON.stringify({
            url: args.url,
            width: args.width || 1280,
            height: args.height || 720,
          }),
        });
        if (!res.ok) throw new Error(`Renderer returned ${res.status}`);
        const { image } = await res.json();
        return {
          kind: "result",
          result: {
            content: [{ type: "image", data: image, mimeType: "image/png" }],
          },
        };
      }

      // No renderer available for screenshot
      return {
        kind: "result",
        result: {
          content: [
            {
              type: "text",
              text: "Screenshot requires a JS renderer. Configure Browserless or a custom renderer in Settings → JS Renderer.",
            },
          ],
          isError: true,
        },
      };
    }

    case "search_and_scrape": {
      const searchResults = await searchWeb(
        args.query as string,
        (args.maxResults as number) || 3,
      );
      const scraped: string[] = [];
      for (const item of searchResults) {
        try {
          const { markdown, title } = await scrapeUrl(item.url);
          scraped.push(
            `# ${title}\nURL: ${item.url}\n\n${markdown.slice(0, 4000)}\n\n---`,
          );
        } catch {
          scraped.push(
            `# ${item.title}\nURL: ${item.url}\nFailed to scrape.\n\n---`,
          );
        }
      }
      return {
        kind: "result",
        result: { content: [{ type: "text", text: scraped.join("\n\n") }] },
      };
    }

    case "test_ai_provider": {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      if (!aiSettings) {
        return {
          kind: "result",
          result: {
            content: [
              { type: "text", text: "Error: AI provider not configured." },
            ],
            isError: true,
          },
        };
      }

      const res = await fetch(getChatCompletionsUrl(aiSettings), {
        method: "POST",
        headers: getAiRequestHeaders(aiSettings),
        body: JSON.stringify({
          model: aiSettings.model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: `AI provider test failed ${res.status}: ${body.slice(0, 500)}`,
              },
            ],
            isError: true,
          },
        };
      }

      return {
        kind: "result",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  provider: aiSettings.provider,
                  model: aiSettings.model,
                },
                null,
                2,
              ),
            },
          ],
        },
      };
    }

    case "github_models_catalog": {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      const token =
        (args.token as string) ||
        (aiSettings && isGitHubModelsProvider(aiSettings)
          ? aiSettings.apiKey
          : "");

      if (!token) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: "Error: Provide a GitHub token with models:read, or save GitHub Models as your AI provider first.",
              },
            ],
            isError: true,
          },
        };
      }

      const res = await fetch("https://models.github.ai/catalog/models", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });
      const body = await res.text();
      if (!res.ok) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: `GitHub Models catalog error ${res.status}: ${body.slice(0, 500)}`,
              },
            ],
            isError: true,
          },
        };
      }

      return {
        kind: "result",
        result: { content: [{ type: "text", text: body }] },
      };
    }

    case "html_to_markdown": {
      return {
        kind: "result",
        result: {
          content: [
            { type: "text", text: htmlToMarkdown(args.html as string) },
          ],
        },
      };
    }

    case "batch_scrape": {
      const job = await createJob(authHeader, "batch_scrape", args);
      if (job.error) {
        return {
          kind: "result",
          result: {
            content: [
              { type: "text", text: `Error creating batch job: ${job.error}` },
            ],
            isError: true,
          },
        };
      }
      EdgeRuntime.waitUntil(processBatchScrapeJob(job.jobId, args));
      return {
        kind: "result",
        result: createPendingJobResult(
          job.jobId,
          "Batch scrape started. Use check_batch_status tool with this jobId to poll for results.",
        ),
      };
    }

    case "check_crawl_status":
    case "check_batch_status":
    case "agent_status": {
      return {
        kind: "result",
        result: await getJobStatusResult(authHeader, args.jobId as string),
      };
    }

    case "agent": {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      if (!aiSettings) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key.",
              },
            ],
            isError: true,
          },
        };
      }

      const job = await createJob(authHeader, "agent", args);
      if (job.error) {
        return {
          kind: "result",
          result: {
            content: [
              { type: "text", text: `Error creating agent job: ${job.error}` },
            ],
            isError: true,
          },
        };
      }
      EdgeRuntime.waitUntil(processAgentJob(job.jobId, args, aiSettings));
      return {
        kind: "result",
        result: createPendingJobResult(
          job.jobId,
          "Agent research started. Use agent_status tool with this jobId to poll for results.",
        ),
      };
    }

    case "chat": {
      const userSettings = await getUserSettings(authHeader);
      const aiSettings = getAiSettingsFromMap(userSettings);
      if (!aiSettings) {
        return {
          kind: "result",
          result: {
            content: [
              {
                type: "text",
                text: "Error: AI provider not configured. Go to Settings → AI Provider and add your API key.",
              },
            ],
            isError: true,
          },
        };
      }

      if (args.stream === true) {
        const streamMode = (args.mode as string) || "orchestrate";
        const images = (args.images as string[]) || [];
        const history =
          (args.history as Array<{ role: string; content: string }>) || [];
        const message = (args.message as string) || "";

        if (streamMode === "synthesis") {
          const systemPrompt =
            history.find((item) => item.role === "system")?.content ||
            "You are a helpful assistant.";
          const nonSystemHistory = history.filter(
            (item) => item.role !== "system",
          );
          const userContent = buildMultimodalContent(
            buildHistoryContext(nonSystemHistory, message),
            images,
          );
          return {
            kind: "response",
            response: new Response(
              callAIStream(aiSettings, systemPrompt, userContent, 4096),
              {
                headers: {
                  ...corsHeaders,
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                },
              },
            ),
          };
        }

        const intent = classifyChatIntent(message);
        if (images.length > 0 || intent === "casual") {
          const userContent = buildMultimodalContent(
            buildHistoryContext(history, message),
            images,
          );
          const systemPrompt =
            images.length > 0 && intent !== "casual"
              ? "You are a helpful AI assistant. The user has sent image(s) along with their query. Analyze the image(s) carefully and answer based on what you see. Be specific, accurate, and honest. If you cannot determine something from the image, say so."
              : "You are a helpful AI assistant for Personal Firecrawl MCP, a web intelligence server. Answer conversationally and helpfully. If the user sends images, describe and analyze them.";
          return {
            kind: "response",
            response: new Response(
              callAIStream(aiSettings, systemPrompt, userContent),
              {
                headers: {
                  ...corsHeaders,
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                },
              },
            ),
          };
        }
      }

      return {
        kind: "result",
        result: await handleChatWithOrchestration(args, aiSettings, authHeader),
      };
    }

    default:
      return { kind: "unknown-tool" };
  }
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
