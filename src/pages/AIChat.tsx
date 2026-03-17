import { useState, useRef, useEffect, useCallback } from "react";
import { useMCPServer } from "@/hooks/useMCPServer";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Bot, User, Wrench, XCircle, Search, Globe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCallResult } from "@/types/mcp";
import { supabase } from "@/integrations/supabase/client";
import { SlashCommandPicker } from "@/components/SlashCommandPicker";
import { classifyIntent, registerJob, type JobType } from "@/lib/intentClassifier";

// ========== Escalation helpers ==========
const RANKING_PATTERNS = [
  /\btop\s*\d+/i, /\btop[\s-]rated/i, /\bbest\b/i, /\branking/i, /\branked\b/i,
  /\bcompare\b/i, /\bcomparison/i, /\bversus\b/i, /\bvs\b/i,
  /\balternatives?\b/i, /\bleaderboard/i, /\blist\s+of\b/i,
  /\bwhich\s+is\s+better/i, /\brecommend/i,
];

function isRankingQuery(text: string): boolean {
  return RANKING_PATTERNS.some(p => p.test(text));
}

/** Search evidence is considered "deep enough" only if it contains substantial article body text,
 *  not just titles/URLs/snippets. For ranking queries we need actual article content. */
function searchEvidenceHasDepth(evidence: string): boolean {
  // Strip out the structured search result lines (titles, URLs)
  const stripped = evidence
    .split("\n")
    .filter(l => !l.match(/^\[?\d+\]/) && !l.match(/^\s*URL:/i) && !l.match(/^---\s/))
    .join(" ")
    .trim();
  // Need at least 2000 chars of actual prose to consider it deep enough for a ranked answer
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
      const type: JobType = toolName === "crawl" ? "crawl" : toolName === "batch_scrape" ? "batch_scrape" : "agent";
      registerJob(parsed.jobId, type);
    }
  } catch { /* not json */ }
}

// ========== Per-tool evidence normalization ==========
interface NormalizedEvidence {
  evidence: string;
  sourceUrls: string[];
}

function normalizeEvidence(toolName: string, result: ToolCallResult): NormalizedEvidence {
  const raw = result.content.map(c => c.text ?? "").join("\n");
  const sourceUrls: string[] = [];

  // --- search: JSON array of {title, url, snippet} ---
  if (toolName === "search") {
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        const lines = items.map((r: any, i: number) => {
          if (r.url) sourceUrls.push(r.url);
          return `[${i + 1}] ${r.title || "Untitled"}\n    URL: ${r.url || "N/A"}\n    ${r.snippet || ""}`;
        });
        return { evidence: lines.join("\n\n"), sourceUrls };
      }
    } catch { /* fall through */ }
  }

  // --- scrape / scrape_js: markdown prefixed with "# Title\n\n..." ---
  if (toolName === "scrape" || toolName === "scrape_js") {
    // Extract title from first heading
    const titleMatch = raw.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1] : "Scraped page";
    // Truncate to useful length
    const content = raw.slice(0, 8000);
    return { evidence: `## ${title}\n\n${content}`, sourceUrls };
  }

  // --- search_and_scrape: multiple scraped pages separated by "---" ---
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

  // --- extract: AI-generated structured data (often JSON) ---
  if (toolName === "extract") {
    return { evidence: `## Extracted Data\n\n${raw.slice(0, 6000)}`, sourceUrls };
  }

  // --- agent_status: job result with synthesis ---
  if (toolName === "agent_status") {
    try {
      const data = JSON.parse(raw);
      if (data.synthesis) {
        // Pull source URLs from the job output
        if (Array.isArray(data.sourcesUsed)) sourceUrls.push(...data.sourcesUsed);
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
      // Still processing or no synthesis
      return { evidence: `Agent job status: ${data.status || "unknown"}\n${JSON.stringify(data, null, 2).slice(0, 4000)}`, sourceUrls };
    } catch { /* fall through */ }
  }

  // --- check_crawl_status / check_batch_status ---
  if (toolName === "check_crawl_status" || toolName === "check_batch_status") {
    try {
      const data = JSON.parse(raw);
      if (data.status === "completed") {
        const pages = data.pages || data.results || [];
        if (Array.isArray(pages)) {
          const lines = pages.slice(0, 20).map((p: any, i: number) => {
            if (p.url) sourceUrls.push(p.url);
            const title = p.title || p.url || `Page ${i + 1}`;
            const content = p.markdown ? p.markdown.slice(0, 500) : "";
            return `[${i + 1}] ${title}\n    URL: ${p.url || "N/A"}\n    ${content}`;
          });
          return { evidence: `## ${toolName === "check_crawl_status" ? "Crawl" : "Batch Scrape"} Results (${pages.length} pages)\n\n${lines.join("\n\n")}`, sourceUrls };
        }
      }
      return { evidence: `Job status: ${data.status || "unknown"}\n${JSON.stringify(data, null, 2).slice(0, 4000)}`, sourceUrls };
    } catch { /* fall through */ }
  }

  // --- fallback: extract URLs from raw text ---
  const urlMatches = raw.match(/https?:\/\/[^\s<>"']+/g);
  if (urlMatches) sourceUrls.push(...urlMatches.slice(0, 10));

  return { evidence: raw.slice(0, 15000), sourceUrls };
}

// ========== Main component ==========
export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const { callTool } = useMCPServer();
  const { settings } = useSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showSlashPicker, setShowSlashPicker] = useState(false);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Elapsed timer
  useEffect(() => {
    if (!loading || !loadingStartedAt) return;
    const interval = setInterval(() => setElapsed((Date.now() - loadingStartedAt) / 1000), 100);
    return () => clearInterval(interval);
  }, [loading, loadingStartedAt]);

  const addMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setLoadingStartedAt(null);
    setCurrentStep("");
    addMessage({ role: "assistant", content: "⚠️ Request cancelled." });
  }, [addMessage]);

  const logToMonitor = async (toolName: string, toolInput: Record<string, unknown>, output: ToolCallResult, duration: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("mcp_logs").insert({
          user_id: user.id, tool: toolName,
          input: toolInput as any, output: output as any,
          status: output.isError ? "error" : "success",
          duration_ms: duration,
        });
      }
    } catch { /* don't block */ }
  };

  const getHistory = useCallback(() => {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // ========== Main send handler ==========
  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    addMessage({ role: "user", content: text });

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadingStartedAt(Date.now());

    const timeout = setTimeout(() => {
      controller.abort();
      setLoading(false);
      setLoadingStartedAt(null);
      setCurrentStep("");
      addMessage({ role: "assistant", content: "⏱️ Request timed out after 60s." });
    }, 60000);

    try {
      const history = getHistory();
      const rendererAvailable = settings.renderer_enabled === "true";
      const intent = classifyIntent(text, history, { rendererAvailable });

      // --- Local-only messages (errors, limitations) ---
      if (intent.localMessage) {
        addMessage({ role: "assistant", content: intent.localMessage });
        return;
      }

      if (intent.actions.length === 0) {
        addMessage({ role: "assistant", content: "I couldn't determine what to do. Try a slash command or rephrase your request." });
        return;
      }

      // --- Show routing reasoning ---
      addMessage({ role: "tool", content: `🧭 ${intent.reasoning}`, toolName: "router" });

      // --- Execute tool actions sequentially, collecting results ---
      const toolResults: Array<{ tool: string; result: ToolCallResult; duration: number }> = [];

      for (const action of intent.actions) {
        if (controller.signal.aborted) break;

        const meta = TOOL_META[action.tool] || { icon: "🔧", label: action.tool };
        setCurrentStep(`${meta.icon} ${meta.label}...`);

        // Show tool execution step
        addMessage({
          role: "tool",
          content: `${meta.icon} ${meta.label}...`,
          toolName: action.tool,
          toolInput: action.args as Record<string, unknown>,
        });

        // Inject conversation history for chat tool
        if (action.tool === "chat" && "message" in action.args) {
          (action.args as any).history = history;
        }

        const start = Date.now();
        const result = await callTool(action.tool, action.args as Record<string, unknown>);
        const duration = Date.now() - start;

        if (controller.signal.aborted) return;

        // Log to request monitor
        await logToMonitor(action.tool, action.args as Record<string, unknown>, result, duration);

        // Register async jobs for future status lookups
        maybeRegisterJob(action.tool, result);

        toolResults.push({ tool: action.tool, result, duration });
      }

      if (controller.signal.aborted) return;

      if (toolResults.length === 0) {
        addMessage({ role: "assistant", content: "No results returned." });
        return;
      }

      const lastResult = toolResults[toolResults.length - 1];

      // === SYNTHESIS PATH ===
      // When synthesize=true and we have tool evidence, pass it through AI for a grounded answer
      if (intent.synthesize && !lastResult.result.isError) {
        let allEvidence = toolResults
          .filter(r => r.tool !== "chat")
          .map(r => {
            const norm = normalizeEvidence(r.tool, r.result);
            return { tool: r.tool, ...norm };
          });

        let combinedEvidence = allEvidence
          .map(e => `--- Evidence from ${e.tool} ---\n${e.evidence}`)
          .join("\n\n");

        // === AUTO-ESCALATION ===
        // If search returned only thin snippets and the query needs ranked/list/comparison data,
        // escalate to search_and_scrape for deeper evidence before synthesizing.
        const onlySearchSoFar = toolResults.every(r => r.tool === "search");
        const evidenceThin = onlySearchSoFar && isSearchEvidenceThin(combinedEvidence);
        const queryNeedsDepth = isRankingQuery(text);

        if (evidenceThin && queryNeedsDepth && !controller.signal.aborted) {
          setCurrentStep("🔎 Search snippets too thin — escalating to deeper scrape...");
          addMessage({
            role: "tool",
            content: "🔎 Search snippets insufficient for a ranked answer. Escalating to search_and_scrape for deeper evidence...",
            toolName: "escalation",
          });

          const escalationStart = Date.now();
          const escalationResult = await callTool("search_and_scrape", {
            query: text,
            maxResults: 3,
          });
          const escalationDuration = Date.now() - escalationStart;

          if (controller.signal.aborted) return;

          await logToMonitor("search_and_scrape", { query: text, maxResults: 3 }, escalationResult, escalationDuration);
          maybeRegisterJob("search_and_scrape", escalationResult);

          if (!escalationResult.isError) {
            const escalationEvidence = normalizeEvidence("search_and_scrape", escalationResult);
            allEvidence.push({ tool: "search_and_scrape", ...escalationEvidence });
            combinedEvidence = allEvidence
              .map(e => `--- Evidence from ${e.tool} ---\n${e.evidence}`)
              .join("\n\n");
          }
        }

        const allSourceUrls = [...new Set(allEvidence.flatMap(e => e.sourceUrls))];
        const toolsUsed = [...new Set(toolResults.map(r => r.tool).concat(evidenceThin && queryNeedsDepth ? ["search_and_scrape"] : []))];
        const evidenceIsSubstantial = combinedEvidence.length > 100;

        if (evidenceIsSubstantial) {
          setCurrentStep("💬 Synthesizing grounded answer...");
          addMessage({ role: "tool", content: "💬 Synthesizing answer from evidence...", toolName: "synthesis" });

          const synthesisPrompt = [
            "You are a research assistant. Answer the user's question based ONLY on the evidence provided below.",
            "CRITICAL RULES:",
            "1. Use ONLY the evidence below. Do NOT fill gaps with your own knowledge or training data.",
            "2. If the evidence is insufficient or does not address the question, explicitly state what was found and what is missing. Do NOT generate a speculative answer.",
            "3. Cite sources by title or URL when making claims.",
            "4. Be structured, clear, and concise.",
            "5. If evidence contains conflicting information, note the discrepancy.",
            `6. Evidence was gathered using: ${toolsUsed.join(", ")}`,
            allSourceUrls.length > 0 ? `7. Available source URLs: ${allSourceUrls.slice(0, 10).join(", ")}` : "",
          ].filter(Boolean).join("\n");

          const synthesisResult = await callTool("chat", {
            message: `User question: ${text}\n\n${combinedEvidence.slice(0, 14000)}`,
            history: [{ role: "system", content: synthesisPrompt }],
          });

          if (controller.signal.aborted) return;

          const answer = synthesisResult.content.map(c => c.text ?? "").join("\n");

          // Append source URLs footer if the model didn't include them
          let sourcesFooter = "";
          if (allSourceUrls.length > 0 && !answer.includes("http")) {
            sourcesFooter = `\n\n**Sources:**\n${allSourceUrls.slice(0, 6).map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
          }

          addMessage({ role: "assistant", content: answer + sourcesFooter });
          return;
        }
        // Evidence too thin even after escalation — fall through to direct display with a note
      }

      // === ASYNC JOB RESULT FORMATTING ===
      if (["crawl", "batch_scrape", "agent"].includes(lastResult.tool) && !lastResult.result.isError) {
        const resultText = lastResult.result.content.map(c => c.text ?? "").join("\n");
        try {
          const parsed = JSON.parse(resultText);
          if (parsed.jobId) {
            addMessage({
              role: "assistant",
              content: `✅ **Job started!**\n\n**Job ID:** \`${parsed.jobId}\`\n**Status:** ${parsed.status}\n\nUse \`/status ${parsed.jobId}\` to check progress, or just paste the job ID.`,
            });
            return;
          }
        } catch { /* not JSON, fall through */ }
      }

      // === DIRECT RESULT DISPLAY ===
      const resultText = lastResult.result.content.map(c => c.text ?? `[${c.type}]`).join("\n");
      addMessage({
        role: lastResult.result.isError ? "tool" : "assistant",
        content: resultText.slice(0, 8000),
        toolName: lastResult.result.isError ? lastResult.tool : undefined,
        toolOutput: lastResult.result,
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
      setCurrentStep("");
    }
  };

  const providerLabel = settings.ai_provider || "";
  const modelLabel = settings.ai_model || "";

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber mb-4">AI CHAT</h1>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-auto space-y-3 scrollbar-cyber pr-2 mb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground/60 font-mono">
                Tools-first AI assistant — 15 MCP tools
              </p>
              <div className="text-[11px] text-muted-foreground/40 font-mono space-y-1">
                <p>Ask anything — I'll pick the right tool automatically</p>
                <p className="flex items-center justify-center gap-1.5">
                  <Search className="h-3 w-3" /> Factual questions → <span className="text-primary">search + evidence</span>
                </p>
                <p className="flex items-center justify-center gap-1.5">
                  <Globe className="h-3 w-3" /> Paste a URL → <span className="text-primary">auto-scrape</span>
                </p>
                <p className="flex items-center justify-center gap-1.5">
                  <Zap className="h-3 w-3" /> Type / for commands → <span className="text-primary">direct tool access</span>
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

        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex gap-3", msg.role === "user" && "justify-end")}>
            {msg.role !== "user" && (
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "tool" ? "bg-cyber-violet/20 text-cyber-violet" : "bg-primary/20 text-primary"
              )}>
                {msg.role === "tool" ? <Wrench className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </div>
            )}
            <div className={cn(
              "rounded-lg px-4 py-2.5 max-w-[80%] text-sm",
              msg.role === "user"
                ? "bg-primary/15 text-foreground"
                : msg.role === "tool"
                ? "bg-cyber-violet/5 border border-cyber-violet/20 text-muted-foreground text-xs font-mono"
                : "glass text-foreground"
            )}>
              {msg.toolName && msg.role === "tool" && (
                <span className="text-cyber-violet font-semibold">{msg.toolName}: </span>
              )}
              <span className="whitespace-pre-wrap break-words">{msg.content}</span>
            </div>
            {msg.role === "user" && (
              <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-foreground/60" />
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator with current step */}
        {loading && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <div className="glass rounded-lg px-4 py-2.5 space-y-1">
              <span className="text-sm text-muted-foreground">{currentStep || "🤖 Processing..."}</span>
              {elapsed > 5 && (
                <p className="text-[10px] text-cyber-amber font-mono">Still working... ({elapsed.toFixed(0)}s)</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="relative glass rounded-lg p-3 flex gap-2">
        <SlashCommandPicker
          input={input}
          visible={showSlashPicker && input.startsWith("/") && !input.includes(" ")}
          onSelect={(cmd) => { setInput(cmd); setShowSlashPicker(false); }}
          onDismiss={() => setShowSlashPicker(false)}
        />
        <Input
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowSlashPicker(e.target.value.startsWith("/")); }}
          onKeyDown={(e) => {
            if (showSlashPicker && input.startsWith("/") && !input.includes(" ")) {
              if (["ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
              if (e.key === "Enter") return;
            }
            if (e.key === "Enter" && !e.shiftKey) handleSend();
          }}
          placeholder="Ask anything, paste a URL, or type / for commands..."
          className="bg-transparent border-none font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={loading}
        />
        {loading ? (
          <Button onClick={cancel} size="icon" variant="outline" className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10">
            <XCircle className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={!input.trim()} size="icon" className="shrink-0 bg-primary text-primary-foreground">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
