import { useState, useRef, useEffect, useCallback } from "react";
import { useMCPServer } from "@/hooks/useMCPServer";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, XCircle, Search, Globe, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCallResult, ToolTraceStep } from "@/types/mcp";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import { SlashCommandPicker } from "@/components/SlashCommandPicker";
import { ChatActivityIndicator } from "@/components/ChatActivityIndicator";
import { ThinkingPanel } from "@/components/ThinkingPanel";
import { ImageUploadButton } from "@/components/ImageUploadButton";
import { ImageLightbox } from "@/components/ImageLightbox";

import {
  classifyIntent,
  registerJob,
  needsEvidence,
  type JobType,
} from "@/lib/intentClassifier";
import { detectRecencyProfile } from "@/lib/recency";
import {
  checkVisionSupport,
  addVisionOverride,
  confirmVisionWorked,
} from "@/lib/visionCapability";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { createThumbnail } from "@/lib/imageUtils";
import { toast } from "sonner";

// ========== Escalation helpers ==========
const RANKING_PATTERNS = [
  /\btop\s*\d+/i,
  /\btop[\s-]rated/i,
  /\bbest\b/i,
  /\branking/i,
  /\branked\b/i,
  /\bcompare\b/i,
  /\bcomparison/i,
  /\bversus\b/i,
  /\bvs\b/i,
  /\balternatives?\b/i,
  /\bleaderboard/i,
  /\blist\s+of\b/i,
  /\bwhich\s+is\s+better/i,
  /\brecommend/i,
];

function isRankingQuery(text: string): boolean {
  return RANKING_PATTERNS.some((p) => p.test(text));
}

function searchEvidenceHasDepth(evidence: string): boolean {
  const stripped = evidence
    .split("\n")
    .filter(
      (l) =>
        !l.match(/^\[?\d+\]/) && !l.match(/^\s*URL:/i) && !l.match(/^---\s/),
    )
    .join(" ")
    .trim();
  return stripped.length > 2000;
}

// ========== Tool display metadata ==========
const TOOL_META: Record<string, { icon: string; label: string }> = {
  search: { icon: "🔍", label: "Searching the web" },
  scrape: { icon: "🕷️", label: "Scraping page" },
  scrape_js: { icon: "⚡", label: "JS-rendering page" },
  crawl: { icon: "🕸️", label: "Starting crawl" },
  map: { icon: "🗺️", label: "Mapping site" },
  extract: { icon: "🤖", label: "Extracting data" },
  screenshot: { icon: "📸", label: "Taking screenshot" },
  search_and_scrape: { icon: "🔎", label: "Searching & scraping" },
  html_to_markdown: { icon: "🔄", label: "Converting HTML" },
  batch_scrape: { icon: "📦", label: "Batch scraping" },
  check_crawl_status: { icon: "⏱️", label: "Checking crawl status" },
  check_batch_status: { icon: "⏱️", label: "Checking batch status" },
  agent: { icon: "🧠", label: "Launching research agent" },
  agent_status: { icon: "⏱️", label: "Checking agent status" },
  chat: { icon: "💬", label: "Thinking" },
};

// ========== Job registration from tool results ==========
function maybeRegisterJob(toolName: string, result: ToolCallResult) {
  if (!["crawl", "batch_scrape", "agent"].includes(toolName)) return;
  try {
    const text = result.content[0]?.text;
    if (!text) return;
    const parsed = JSON.parse(text);
    if (parsed.jobId) {
      const type: JobType =
        toolName === "crawl"
          ? "crawl"
          : toolName === "batch_scrape"
            ? "batch_scrape"
            : "agent";
      registerJob(parsed.jobId, type);
    }
  } catch {
    /* not json */
  }
}

// ========== Per-tool evidence normalization ==========
interface NormalizedEvidence {
  evidence: string;
  sourceUrls: string[];
}

interface SearchEvidenceItem {
  title?: string;
  url?: string;
  snippet?: string;
}

interface PageEvidenceItem {
  title?: string;
  url?: string;
  markdown?: string;
}

function normalizeEvidence(
  toolName: string,
  result: ToolCallResult,
): NormalizedEvidence {
  const raw = result.content.map((c) => c.text ?? "").join("\n");
  const sourceUrls: string[] = [];

  if (toolName === "search") {
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        const lines = (items as SearchEvidenceItem[]).map((r, i: number) => {
          if (r.url) sourceUrls.push(r.url);
          return `[${i + 1}] ${r.title || "Untitled"}\n    URL: ${r.url || "N/A"}\n    ${r.snippet || ""}`;
        });
        return { evidence: lines.join("\n\n"), sourceUrls };
      }
    } catch {
      /* fall through */
    }
  }

  if (toolName === "scrape" || toolName === "scrape_js") {
    const titleMatch = raw.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1] : "Scraped page";
    const content = raw.slice(0, 8000);
    return { evidence: `## ${title}\n\n${content}`, sourceUrls };
  }

  if (toolName === "search_and_scrape") {
    const sections = raw.split(/\n---\n/).filter(Boolean);
    const normalized = sections.map((section, i) => {
      const urlMatch = section.match(/URL:\s*(https?:\/\/[^\s]+)/i);
      if (urlMatch) sourceUrls.push(urlMatch[1]);
      const titleMatch = section.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1] : `Source ${i + 1}`;
      return `### ${title}\n${urlMatch ? `Source: ${urlMatch[1]}` : ""}\n\n${section.slice(0, 4000)}`;
    });
    return { evidence: normalized.join("\n\n---\n\n"), sourceUrls };
  }

  if (toolName === "extract") {
    return {
      evidence: `## Extracted Data\n\n${raw.slice(0, 6000)}`,
      sourceUrls,
    };
  }

  if (toolName === "agent_status") {
    try {
      const data = JSON.parse(raw);
      if (data.synthesis) {
        if (Array.isArray(data.sourcesUsed))
          sourceUrls.push(...data.sourcesUsed);
        if (Array.isArray(data.sources)) {
          for (const s of data.sources) {
            if (s.finalUrl) sourceUrls.push(s.finalUrl);
            else if (s.sourceUrl) sourceUrls.push(s.sourceUrl);
          }
        }
        return {
          evidence: `## Agent Research Result\n\nGroundedness: ${data.groundedness || "unknown"}\n${data.warning ? `⚠️ ${data.warning}\n` : ""}\n${data.synthesis}`,
          sourceUrls: [...new Set(sourceUrls)],
        };
      }
      return {
        evidence: `Agent job status: ${data.status || "unknown"}\n${JSON.stringify(data, null, 2).slice(0, 4000)}`,
        sourceUrls,
      };
    } catch {
      /* fall through */
    }
  }

  if (toolName === "check_crawl_status" || toolName === "check_batch_status") {
    try {
      const data = JSON.parse(raw);
      if (data.status === "completed") {
        const pages = data.pages || data.results || [];
        if (Array.isArray(pages)) {
          const lines = (pages as PageEvidenceItem[])
            .slice(0, 20)
            .map((p, i: number) => {
              if (p.url) sourceUrls.push(p.url);
              const title = p.title || p.url || `Page ${i + 1}`;
              const content = p.markdown ? p.markdown.slice(0, 500) : "";
              return `[${i + 1}] ${title}\n    URL: ${p.url || "N/A"}\n    ${content}`;
            });
          return {
            evidence: `## ${toolName === "check_crawl_status" ? "Crawl" : "Batch Scrape"} Results (${pages.length} pages)\n\n${lines.join("\n\n")}`,
            sourceUrls,
          };
        }
      }
      return {
        evidence: `Job status: ${data.status || "unknown"}\n${JSON.stringify(data, null, 2).slice(0, 4000)}`,
        sourceUrls,
      };
    } catch {
      /* fall through */
    }
  }

  const urlMatches = raw.match(/https?:\/\/[^\s<>"']+/g);
  if (urlMatches) sourceUrls.push(...urlMatches.slice(0, 10));

  return { evidence: raw.slice(0, 15000), sourceUrls };
}

// ========== Main component ==========
export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [activitySteps, setActivitySteps] = useState<string[]>([]);
  const { callTool, callToolStream } = useMCPServer();
  const { settings } = useSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showSlashPicker, setShowSlashPicker] = useState(false);

  // Vision unknown confirmation state
  const [visionWarning, setVisionWarning] = useState<{
    reason: string;
    text: string;
    images: string[];
  } | null>(null);

  // Streaming state
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<
    "idle" | "thinking" | "answering"
  >("idle");

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, activitySteps, streamingContent, streamingThinking]);

  useEffect(() => {
    if (!loading || !loadingStartedAt) return;
    const interval = setInterval(
      () => setElapsed((Date.now() - loadingStartedAt) / 1000),
      100,
    );
    return () => clearInterval(interval);
  }, [loading, loadingStartedAt]);

  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id" | "timestamp">) => {
      setMessages((prev) => [
        ...prev,
        { ...msg, id: crypto.randomUUID(), timestamp: new Date() },
      ]);
    },
    [],
  );

  const pushActivity = useCallback((step: string) => {
    setActivitySteps((prev) => [...prev, step]);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setLoadingStartedAt(null);
    setActivitySteps([]);
    setIsStreaming(false);
    setStreamPhase("idle");
    setStreamingThinking("");
    setStreamingContent("");
    addMessage({ role: "assistant", content: "⚠️ Request cancelled." });
  }, [addMessage]);

  const logToMonitor = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    output: ToolCallResult,
    duration: number,
  ) => {
    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Server-side mcp-server now records every tools/call, so no extra insert here.
    } catch {
      /* don't block */
    }
  };

  const getHistory = useCallback(() => {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // ========== Vision "Try anyway" handler ==========
  const handleVisionTryAnyway = useCallback(() => {
    if (!visionWarning) return;
    const { text, images } = visionWarning;
    // Register override so future sends skip the warning
    addVisionOverride(
      settings.ai_base_url || "https://api.openai.com/v1",
      settings.ai_model || "",
    );
    setVisionWarning(null);
    // Re-inject text and images — handleSend will now pass the guard
    setInput(text);
    setPendingImages(images);
    // Use microtask so state applies before send triggers
    setTimeout(() => {
      const sendBtn = document.querySelector(
        "[data-send-btn]",
      ) as HTMLButtonElement | null;
      sendBtn?.click();
    }, 50);
  }, [visionWarning, settings.ai_base_url, settings.ai_model]);

  // ========== Main send handler ==========
  const handleSend = async () => {
    const text = input.trim();
    const images = [...pendingImages];
    if ((!text && images.length === 0) || loading) return;

    // --- Vision guard: run BEFORE adding the user message to prevent duplicates ---
    if (images.length > 0) {
      const visionCheck = checkVisionSupport(
        settings.ai_base_url || "https://api.openai.com/v1",
        settings.ai_model || "",
      );

      if (visionCheck.status === "unsupported") {
        toast.error(
          visionCheck.reason || "Current model does not support image input",
        );
        return;
      }

      if (visionCheck.status === "unknown") {
        setVisionWarning({
          reason:
            visionCheck.reason ||
            "Image support is not verified for this model.",
          text,
          images,
        });
        return;
      }
    }

    // --- Commit: clear inputs and add the single user message ---
    setInput("");
    setPendingImages([]);

    let thumbnails: string[] | undefined;
    if (images.length > 0) {
      thumbnails = await Promise.all(images.map((img) => createThumbnail(img)));
    }
    addMessage({ role: "user", content: text, images: thumbnails });

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadingStartedAt(Date.now());
    setActivitySteps([]);

    const traceSteps: ToolTraceStep[] = [];

    const timeout = setTimeout(() => {
      controller.abort();
      setLoading(false);
      setLoadingStartedAt(null);
      setActivitySteps([]);
      addMessage({
        role: "assistant",
        content: "⏱️ Request timed out after 60s.",
      });
    }, 60000);

    try {
      const history = getHistory();
      const rendererAvailable = settings.renderer_enabled === "true";

      // If images attached, use smart routing
      if (images.length > 0) {
        // Determine if this is a pure image query or needs tool orchestration
        const needsTools =
          text &&
          (needsEvidence(text) ||
            isRankingQuery(text) ||
            /https?:\/\/[^\s]+/i.test(text));

        if (needsTools) {
          // Image + research query: run intent classification, but pass images to final synthesis
          pushActivity("Routing request with image context…");
          const intent = classifyIntent(text, history, { rendererAvailable });

          if (intent.localMessage) {
            addMessage({ role: "assistant", content: intent.localMessage });
            return;
          }

          // Execute tools normally, but include images in the final chat/synthesis call
          // The images will be included when the chat tool is called below
          // We inject them into the action args
          for (const action of intent.actions) {
            if (action.tool === "chat" && "message" in action.args) {
              action.args = { ...action.args, images };
            }
          }

          // Fall through to the normal intent execution flow below
          // (don't return — let the regular code handle it)
          // We need to set images on synthesis calls too
          // This is handled by passing images through to callToolStream
        } else {
          // Pure image analysis (describe, analyze, image-only, simple question about image)
          pushActivity("Analyzing image(s)…");

          const chatArgs: Record<string, unknown> = {
            message: text || "What do you see in this image?",
            history,
            images,
            stream: true,
          };

          const start = Date.now();
          let fullText = "";
          let thinkBuffer = "";
          let inThink = false;
          let thinkDone = false;

          setIsStreaming(true);
          setStreamingThinking("");
          setStreamingContent("");
          setStreamPhase("idle");

          const imgTraceSteps: ToolTraceStep[] = [];

          try {
            for await (const delta of callToolStream(
              "chat",
              chatArgs,
              controller.signal,
            )) {
              if (controller.signal.aborted) return;
              fullText += delta;

              if (!thinkDone) {
                if (!inThink && fullText.includes("<think>")) {
                  inThink = true;
                  setStreamPhase("thinking");
                }
                if (inThink) {
                  const thinkStart = fullText.indexOf("<think>") + 7;
                  const thinkEnd = fullText.indexOf("</think>");
                  if (thinkEnd !== -1) {
                    thinkBuffer = fullText.slice(thinkStart, thinkEnd).trim();
                    thinkDone = true;
                    inThink = false;
                    setStreamingThinking(thinkBuffer);
                    setStreamPhase("answering");
                    const afterThink = fullText.slice(thinkEnd + 8).trim();
                    setStreamingContent(afterThink);
                  } else {
                    thinkBuffer = fullText.slice(thinkStart).trim();
                    setStreamingThinking(thinkBuffer);
                  }
                  continue;
                }
              }

              if (thinkDone) {
                const afterThink = fullText
                  .slice(fullText.indexOf("</think>") + 8)
                  .trim();
                setStreamingContent(afterThink);
              } else {
                setStreamPhase("answering");
                setStreamingContent(fullText);
              }
            }
          } catch (err) {
            if (!controller.signal.aborted) {
              fullText =
                fullText ||
                `Error: ${err instanceof Error ? err.message : "Stream failed"}`;
            }
          }

          const duration = Date.now() - start;

          setIsStreaming(false);
          setStreamPhase("idle");
          setStreamingThinking("");
          setStreamingContent("");

          imgTraceSteps.push({
            tool: "chat",
            label: "Image analysis",
            icon: "🖼️",
            durationMs: duration,
          });
          addMessage({
            role: "assistant",
            content: fullText,
            toolTrace: imgTraceSteps,
          });

          // Auto-verify this provider+model on success
          if (!fullText.startsWith("Error:")) {
            confirmVisionWorked(
              settings.ai_base_url || "https://api.openai.com/v1",
              settings.ai_model || "",
            );
          }

          const finalResult: ToolCallResult = {
            content: [{ type: "text", text: fullText }],
          };
          await logToMonitor("chat", chatArgs, finalResult, duration);
          return;
        }
      }

      const intent = classifyIntent(text, history, { rendererAvailable });

      if (intent.localMessage) {
        addMessage({ role: "assistant", content: intent.localMessage });
        return;
      }

      if (intent.actions.length === 0) {
        addMessage({
          role: "assistant",
          content:
            "I couldn't determine what to do. Try a slash command or rephrase your request.",
        });
        return;
      }

      // Activity: routing
      pushActivity("Routing request…");

      // Execute tool actions, collecting results (no chat bubbles)
      const toolResults: Array<{
        tool: string;
        result: ToolCallResult;
        duration: number;
      }> = [];

      for (const action of intent.actions) {
        if (controller.signal.aborted) break;

        const meta = TOOL_META[action.tool] || {
          icon: "🔧",
          label: action.tool,
        };
        pushActivity(meta.label);

        if (action.tool === "chat" && "message" in action.args) {
          action.args = {
            ...action.args,
            history,
            ...(images.length > 0 ? { images } : {}),
          };

          // Use streaming for chat tool
          const start = Date.now();
          let fullText = "";
          let thinkBuffer = "";
          let inThink = false;
          let thinkDone = false;

          setIsStreaming(true);
          setStreamingThinking("");
          setStreamingContent("");
          setStreamPhase("idle");

          try {
            for await (const delta of callToolStream(
              "chat",
              action.args as Record<string, unknown>,
              controller.signal,
            )) {
              if (controller.signal.aborted) return;
              fullText += delta;

              // Parse <think> tags progressively
              if (!thinkDone) {
                // Check if we've entered a think block
                if (!inThink && fullText.includes("<think>")) {
                  inThink = true;
                  setStreamPhase("thinking");
                }

                if (inThink) {
                  const thinkStart = fullText.indexOf("<think>") + 7;
                  const thinkEnd = fullText.indexOf("</think>");
                  if (thinkEnd !== -1) {
                    // Think block complete
                    thinkBuffer = fullText.slice(thinkStart, thinkEnd).trim();
                    thinkDone = true;
                    inThink = false;
                    setStreamingThinking(thinkBuffer);
                    setStreamPhase("answering");
                    // Extract clean content after </think>
                    const afterThink = fullText.slice(thinkEnd + 8).trim();
                    setStreamingContent(afterThink);
                  } else {
                    // Still in think block
                    thinkBuffer = fullText.slice(thinkStart).trim();
                    setStreamingThinking(thinkBuffer);
                  }
                  continue;
                }
              }

              // Not in think block — stream main content
              if (thinkDone) {
                const afterThink = fullText
                  .slice(fullText.indexOf("</think>") + 8)
                  .trim();
                setStreamingContent(afterThink);
              } else {
                setStreamPhase("answering");
                setStreamingContent(fullText);
              }
            }
          } catch (err) {
            if (!controller.signal.aborted) {
              fullText =
                fullText ||
                `Error: ${err instanceof Error ? err.message : "Stream failed"}`;
            }
          }

          const duration = Date.now() - start;

          // Finalize: strip orchestration and think tags, add as message
          const cleanFull = fullText
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/\n---\n\*Orchestration:[\s\S]*?\*$/gm, "")
            .trim();

          setIsStreaming(false);
          setStreamPhase("idle");
          setStreamingThinking("");
          setStreamingContent("");

          const finalResult: ToolCallResult = {
            content: [{ type: "text", text: fullText }],
          };
          await logToMonitor(
            action.tool,
            action.args as Record<string, unknown>,
            finalResult,
            duration,
          );

          toolResults.push({
            tool: action.tool,
            result: finalResult,
            duration,
          });
          traceSteps.push({
            tool: action.tool,
            label: meta.label,
            icon: meta.icon,
            durationMs: duration,
          });

          // Add the final message directly
          addMessage({
            role: "assistant",
            content: fullText,
            toolTrace: traceSteps,
          });
          return; // Chat streaming handled — skip remaining flow
        }

        const start = Date.now();
        const result = await callTool(
          action.tool,
          action.args as Record<string, unknown>,
        );
        const duration = Date.now() - start;

        if (controller.signal.aborted) return;

        await logToMonitor(
          action.tool,
          action.args as Record<string, unknown>,
          result,
          duration,
        );
        maybeRegisterJob(action.tool, result);

        toolResults.push({ tool: action.tool, result, duration });
        traceSteps.push({
          tool: action.tool,
          label: meta.label,
          icon: meta.icon,
          durationMs: duration,
        });
      }

      if (controller.signal.aborted) return;

      if (toolResults.length === 0) {
        addMessage({ role: "assistant", content: "No results returned." });
        return;
      }

      const lastResult = toolResults[toolResults.length - 1];

      // === SYNTHESIS PATH ===
      if (intent.synthesize && !lastResult.result.isError) {
        const recencyProfile = detectRecencyProfile(text);

        const allEvidence = toolResults
          .filter((r) => r.tool !== "chat")
          .map((r) => {
            const norm = normalizeEvidence(r.tool, r.result);
            return { tool: r.tool, ...norm };
          });

        let combinedEvidence = allEvidence
          .map((e) => `--- Evidence from ${e.tool} ---\n${e.evidence}`)
          .join("\n\n");

        const onlySearchSoFar = toolResults.every((r) => r.tool === "search");
        const queryNeedsDepth = isRankingQuery(text);
        const alreadyDeep = searchEvidenceHasDepth(combinedEvidence);
        const shouldEscalate =
          onlySearchSoFar && queryNeedsDepth && !alreadyDeep;

        if (shouldEscalate && !controller.signal.aborted) {
          pushActivity("Gathering deeper sources…");

          const escalationStart = Date.now();
          const escalationResult = await callTool("search_and_scrape", {
            query: text,
            maxResults: 3,
          });
          const escalationDuration = Date.now() - escalationStart;

          if (controller.signal.aborted) return;

          await logToMonitor(
            "search_and_scrape",
            { query: text, maxResults: 3 },
            escalationResult,
            escalationDuration,
          );
          maybeRegisterJob("search_and_scrape", escalationResult);

          traceSteps.push({
            tool: "search_and_scrape",
            label: "Searching & scraping",
            icon: "🔎",
            durationMs: escalationDuration,
          });

          if (!escalationResult.isError) {
            const escalationEvidence = normalizeEvidence(
              "search_and_scrape",
              escalationResult,
            );
            const hasUsableContent = escalationEvidence.evidence.length > 200;
            if (hasUsableContent) {
              allEvidence.push({
                tool: "search_and_scrape",
                ...escalationEvidence,
              });
              combinedEvidence = allEvidence
                .map((e) => `--- Evidence from ${e.tool} ---\n${e.evidence}`)
                .join("\n\n");
            } else {
              // Escalation returned no usable content — remove from trace
              traceSteps.pop();
            }
          } else {
            // Escalation failed — remove from trace
            traceSteps.pop();
          }
        }

        const allSourceUrls = [
          ...new Set(allEvidence.flatMap((e) => e.sourceUrls)),
        ];
        const toolsUsed = [
          ...new Set(
            toolResults
              .map((r) => r.tool)
              .concat(shouldEscalate ? ["search_and_scrape"] : []),
          ),
        ];
        const evidenceIsSubstantial = combinedEvidence.length > 100;

        if (evidenceIsSubstantial) {
          pushActivity("Synthesizing answer…");

          const isRanking = isRankingQuery(text);
          const sourceCount = allSourceUrls.length;

          const baseRules = [
            "You are a research assistant. Answer the user's question based ONLY on the evidence provided below.",
            "CRITICAL RULES:",
            "1. Use ONLY the evidence below. Do NOT fill gaps with your own knowledge or training data.",
            "2. If the evidence is insufficient or does not address the question, explicitly state what was found and what is missing.",
            "3. Cite sources by title or URL when making claims.",
            "4. Be structured, clear, and concise.",
            "5. If evidence contains conflicting information, note the discrepancy.",
            recencyProfile.mode !== "none"
              ? "When evidence may be stale relative to the user's time frame, do not imply it is current."
              : "",
            `6. Evidence was gathered using: ${toolsUsed.join(", ")}`,
            allSourceUrls.length > 0
              ? `7. Available source URLs: ${allSourceUrls.slice(0, 10).join(", ")}`
              : "",
          ];

          const rankingRules = isRanking
            ? [
                "",
                "RANKING/COMPARISON ANSWER RULES:",
                `8. SOURCE STRENGTH: You have evidence from ${sourceCount} source(s). Be explicit about whether a ranking comes from one primary source or multiple independent sources.`,
                "9. SOURCE ROLES: Distinguish between primary ranking sources, supporting sources, and commentary sources.",
                "10. CATEGORY MIXING: If sources mix foundation models with tools/products, explicitly note the distinction.",
                "11. CONFIDENCE FRAMING: Use language like 'Based on the scraped sources...' Never say 'the definitive top 10' unless multiple sources agree.",
                "12. STRUCTURE: Brief qualification → ranked list → supporting mentions → discrepancies → conclusion",
              ]
            : [];

          const synthesisPrompt = [...baseRules, ...rankingRules]
            .filter(Boolean)
            .join("\n");

          // Stream synthesis
          let synthText = "";
          setIsStreaming(true);
          setStreamingThinking("");
          setStreamingContent("");
          setStreamPhase("answering");

          try {
            for await (const delta of callToolStream(
              "chat",
              {
                message: `User question: ${text}\n\n${combinedEvidence.slice(0, 14000)}`,
                history: [{ role: "system", content: synthesisPrompt }],
                mode: "synthesis",
                recencyProfile,
              },
              controller.signal,
            )) {
              if (controller.signal.aborted) return;
              synthText += delta;
              setStreamingContent(synthText);
            }
          } catch {
            if (controller.signal.aborted) return;
          }

          setIsStreaming(false);
          setStreamPhase("idle");
          setStreamingContent("");

          if (controller.signal.aborted) return;

          traceSteps.push({ tool: "chat", label: "Synthesis", icon: "💬" });

          const answer = synthText;

          let sourcesFooter = "";
          if (allSourceUrls.length > 0 && !answer.includes("http")) {
            sourcesFooter = `\n\n**Sources:**\n${allSourceUrls
              .slice(0, 6)
              .map((u, i) => `${i + 1}. ${u}`)
              .join("\n")}`;
          }

          addMessage({
            role: "assistant",
            content: answer + sourcesFooter,
            toolTrace: traceSteps,
          });
          return;
        }
      }

      // === ASYNC JOB RESULT FORMATTING ===
      if (
        ["crawl", "batch_scrape", "agent"].includes(lastResult.tool) &&
        !lastResult.result.isError
      ) {
        const resultText = lastResult.result.content
          .map((c) => c.text ?? "")
          .join("\n");
        try {
          const parsed = JSON.parse(resultText);
          if (parsed.jobId) {
            addMessage({
              role: "assistant",
              content: `✅ **Job started!**\n\n**Job ID:** \`${parsed.jobId}\`\n**Status:** ${parsed.status}\n\nUse \`/status ${parsed.jobId}\` to check progress, or just paste the job ID.`,
              toolTrace: traceSteps,
            });
            return;
          }
        } catch {
          /* not JSON, fall through */
        }
      }

      // === DIRECT RESULT DISPLAY ===
      const resultText = lastResult.result.content
        .map((c) => c.text ?? `[${c.type}]`)
        .join("\n");
      addMessage({
        role: "assistant",
        content: resultText.slice(0, 8000),
        toolTrace: traceSteps.length > 0 ? traceSteps : undefined,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        addMessage({ role: "assistant", content: `❌ Error: ${msg}` });
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
      setLoadingStartedAt(null);
      setActivitySteps([]);
    }
  };

  const providerLabel = settings.ai_provider || "";
  const modelLabel = settings.ai_model || "";

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber mb-4">
        AI CHAT
      </h1>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto space-y-3 scrollbar-cyber pr-2 mb-4"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground/60 font-mono">
                Tools-first AI assistant — 20 MCP tools
              </p>
              <div className="text-[11px] text-muted-foreground/40 font-mono space-y-1">
                <p>Ask anything — I'll pick the right tool automatically</p>
                <p className="flex items-center justify-center gap-1.5">
                  <Search className="h-3 w-3" /> Factual questions →{" "}
                  <span className="text-primary">search + evidence</span>
                </p>
                <p className="flex items-center justify-center gap-1.5">
                  <Globe className="h-3 w-3" /> Paste a URL →{" "}
                  <span className="text-primary">auto-scrape</span>
                </p>
                <p className="flex items-center justify-center gap-1.5">
                  <Zap className="h-3 w-3" /> Type / for commands →{" "}
                  <span className="text-primary">direct tool access</span>
                </p>
              </div>
              {providerLabel && (
                <p className="text-[10px] text-muted-foreground/25 font-mono">
                  AI: {providerLabel} → {modelLabel}
                </p>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          // Skip rendering tool-role messages entirely
          if (msg.role === "tool") return null;

          return (
            <div
              key={msg.id}
              className={cn("flex gap-3", msg.role === "user" && "justify-end")}
            >
              {msg.role === "assistant" && (
                <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "rounded-lg px-4 py-2.5 max-w-[80%] text-sm",
                  msg.role === "user"
                    ? "bg-primary/15 text-foreground"
                    : "glass text-foreground",
                )}
              >
                {msg.role === "assistant" ? (
                  (() => {
                    const thinkMatch = msg.content.match(
                      /<think>([\s\S]*?)<\/think>/i,
                    );
                    const thinkingContent = thinkMatch?.[1]?.trim() || null;
                    const cleanContent = msg.content
                      .replace(/<think>[\s\S]*?<\/think>/gi, "")
                      .replace(/\n---\n\*Orchestration:[\s\S]*?\*$/gm, "")
                      .trim();
                    const totalMs =
                      msg.toolTrace?.reduce(
                        (sum, t) => sum + (t.durationMs ?? 0),
                        0,
                      ) ?? 0;
                    const usedTools = msg.toolTrace
                      ? [
                          ...new Set(
                            msg.toolTrace
                              .map((t) => t.tool)
                              .filter((t) => t !== "chat"),
                          ),
                        ]
                      : [];
                    const truncateModel = (m: string) => {
                      if (!m) return "";
                      const after = m.includes("/") ? m.split("/").pop()! : m;
                      const clean = after
                        .replace(/:free$/i, "")
                        .replace(/-instruct$/i, "");
                      return clean.length > 20
                        ? clean.slice(0, 17) + "…"
                        : clean;
                    };
                    const modelName = truncateModel(settings.ai_model || "");
                    const pillParts: string[] = [];
                    if (usedTools.length > 0)
                      pillParts.push(usedTools.join(", "));
                    if (modelName) pillParts.push(modelName);
                    if (totalMs > 0)
                      pillParts.push(`${(totalMs / 1000).toFixed(1)}s`);
                    return (
                      <>
                        {thinkingContent && (
                          <ThinkingPanel
                            content={thinkingContent}
                            durationMs={totalMs}
                          />
                        )}
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => (
                                <h1 className="text-lg font-bold text-primary mt-2 mb-1">
                                  {children}
                                </h1>
                              ),
                              h2: ({ children }) => (
                                <h2 className="text-base font-bold text-primary/80 mt-2 mb-1">
                                  {children}
                                </h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className="text-sm font-semibold text-primary/70 mt-1 mb-1">
                                  {children}
                                </h3>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-bold text-foreground">
                                  {children}
                                </strong>
                              ),
                              em: ({ children }) => (
                                <em className="italic text-muted-foreground">
                                  {children}
                                </em>
                              ),
                              code: ({ children, className }) => {
                                const isBlock =
                                  className?.includes("language-");
                                return isBlock ? (
                                  <code
                                    className={cn(
                                      "font-mono text-xs",
                                      className,
                                    )}
                                  >
                                    {children}
                                  </code>
                                ) : (
                                  <code className="bg-muted px-1 rounded text-primary font-mono text-xs">
                                    {children}
                                  </code>
                                );
                              },
                              pre: ({ children }) => (
                                <pre className="bg-muted/50 p-3 rounded-lg overflow-x-auto my-2 border border-primary/10">
                                  {children}
                                </pre>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc list-inside space-y-1 my-1">
                                  {children}
                                </ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal list-inside space-y-1 my-1">
                                  {children}
                                </ol>
                              ),
                              li: ({ children }) => (
                                <li className="text-foreground/90">
                                  {children}
                                </li>
                              ),
                              a: ({ href, children }) => (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline hover:text-primary/80"
                                >
                                  {children}
                                </a>
                              ),
                              p: ({ children }) => (
                                <p className="mb-2 last:mb-0">{children}</p>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-primary pl-3 italic text-muted-foreground my-2">
                                  {children}
                                </blockquote>
                              ),
                            }}
                          >
                            {cleanContent}
                          </ReactMarkdown>
                        </div>
                        {pillParts.length > 0 && (
                          <div className="mt-1.5 flex justify-end">
                            <span className="text-[10px] font-mono text-muted-foreground/40">
                              · {pillParts.join(" · ")}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <>
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.images.map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt={`Uploaded ${i + 1}`}
                            className="h-24 max-w-[200px] object-cover rounded-lg border border-primary/10 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setLightboxSrc(img)}
                          />
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <span className="whitespace-pre-wrap break-words">
                        {msg.content}
                      </span>
                    )}
                  </>
                )}
              </div>
              {msg.role === "user" && (
                <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-3.5 w-3.5 text-foreground/60" />
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming bubble */}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="rounded-lg px-4 py-2.5 max-w-[80%] text-sm glass text-foreground">
              {(streamPhase === "thinking" || streamingThinking) && (
                <ThinkingPanel
                  content={streamingThinking}
                  isStreaming={streamPhase === "thinking"}
                />
              )}
              {streamPhase === "answering" && streamingContent && (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-lg font-bold text-primary mt-2 mb-1">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-base font-bold text-primary/80 mt-2 mb-1">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-sm font-semibold text-primary/70 mt-1 mb-1">
                          {children}
                        </h3>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-bold text-foreground">
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic text-muted-foreground">
                          {children}
                        </em>
                      ),
                      code: ({ children, className: cls }) => {
                        const isBlock = cls?.includes("language-");
                        return isBlock ? (
                          <code className={cn("font-mono text-xs", cls)}>
                            {children}
                          </code>
                        ) : (
                          <code className="bg-muted px-1 rounded text-primary font-mono text-xs">
                            {children}
                          </code>
                        );
                      },
                      pre: ({ children }) => (
                        <pre className="bg-muted/50 p-3 rounded-lg overflow-x-auto my-2 border border-primary/10">
                          {children}
                        </pre>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc list-inside space-y-1 my-1">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-inside space-y-1 my-1">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="text-foreground/90">{children}</li>
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline hover:text-primary/80"
                        >
                          {children}
                        </a>
                      ),
                      p: ({ children }) => (
                        <p className="mb-2 last:mb-0">{children}</p>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-primary pl-3 italic text-muted-foreground my-2">
                          {children}
                        </blockquote>
                      ),
                    }}
                  >
                    {streamingContent}
                  </ReactMarkdown>
                </div>
              )}
              {streamPhase === "idle" &&
                !streamingContent &&
                !streamingThinking && (
                  <span className="text-muted-foreground/50 text-xs font-mono">
                    Connecting…
                  </span>
                )}
            </div>
          </div>
        )}

        {/* Inline activity indicator (for non-streaming tools) */}
        {loading && !isStreaming && (
          <ChatActivityIndicator steps={activitySteps} elapsed={elapsed} />
        )}
      </div>

      {/* Input bar */}
      <div className="relative glass rounded-lg p-3 flex gap-2 items-center">
        <SlashCommandPicker
          input={input}
          visible={
            showSlashPicker && input.startsWith("/") && !input.includes(" ")
          }
          onSelect={(cmd) => {
            setInput(cmd);
            setShowSlashPicker(false);
          }}
          onDismiss={() => setShowSlashPicker(false)}
        />
        <ImageUploadButton
          images={pendingImages}
          onAdd={(imgs) =>
            setPendingImages((prev) => [...prev, ...imgs].slice(0, 4))
          }
          onRemove={(i) =>
            setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
          }
          disabled={loading}
        />
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSlashPicker(e.target.value.startsWith("/"));
          }}
          onKeyDown={(e) => {
            if (
              showSlashPicker &&
              input.startsWith("/") &&
              !input.includes(" ")
            ) {
              if (["ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
              if (e.key === "Enter") return;
            }
            if (e.key === "Enter" && !e.shiftKey) handleSend();
          }}
          placeholder={
            pendingImages.length > 0
              ? "Describe image or send as-is..."
              : "Ask anything, paste a URL, or type / for commands..."
          }
          className="bg-transparent border-none font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={loading}
        />
        {loading ? (
          <Button
            onClick={cancel}
            size="icon"
            variant="outline"
            className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <XCircle className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            data-send-btn
            onClick={handleSend}
            disabled={!input.trim() && pendingImages.length === 0}
            size="icon"
            className="shrink-0 bg-primary text-primary-foreground"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* Vision unknown confirmation */}
      <AlertDialog
        open={!!visionWarning}
        onOpenChange={(open) => {
          if (!open) setVisionWarning(null);
        }}
      >
        <AlertDialogContent className="glass border-primary/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-primary font-mono">
              ⚠️ Vision Support Unverified
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {visionWarning?.reason}
              <br />
              <span className="text-xs mt-1 block text-muted-foreground/70">
                If the request succeeds, this model will be remembered as
                vision-capable on this device.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVisionTryAnyway}
              className="font-mono text-xs"
            >
              Try anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
