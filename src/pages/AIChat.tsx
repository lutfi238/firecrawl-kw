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
import { classifyIntent, type ToolAction } from "@/lib/intentClassifier";

// Tool icon/label map for UX
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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

  const logToMonitor = async (toolName: string, input: Record<string, unknown>, output: ToolCallResult, duration: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("mcp_logs").insert({
          user_id: user.id, tool: toolName,
          input: input as any, output: output as any,
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

  const executeTool = useCallback(async (
    action: ToolAction,
    controller: AbortController
  ): Promise<{ result: ToolCallResult; duration: number } | null> => {
    if (controller.signal.aborted) return null;

    const meta = TOOL_META[action.tool] || { icon: "🔧", label: action.tool };
    setCurrentStep(`${meta.icon} ${meta.label}...`);

    // Show tool execution message
    addMessage({
      role: "tool",
      content: `${meta.icon} ${meta.label}...`,
      toolName: action.tool,
      toolInput: action.args as Record<string, unknown>,
    });

    const start = Date.now();
    const result = await callTool(action.tool, action.args as Record<string, unknown>);
    const duration = Date.now() - start;

    if (controller.signal.aborted) return null;

    // Log to monitor
    await logToMonitor(action.tool, action.args as Record<string, unknown>, result, duration);

    return { result, duration };
  }, [callTool, addMessage]);

  const synthesizeFromEvidence = useCallback(async (
    userQuery: string,
    evidence: string,
    toolsUsed: string[],
    controller: AbortController
  ): Promise<string> => {
    if (controller.signal.aborted) return "";
    if (!settings.ai_api_key) {
      return `**Evidence collected via ${toolsUsed.join(", ")}:**\n\n${evidence.slice(0, 4000)}`;
    }

    setCurrentStep("💬 Synthesizing answer from evidence...");
    addMessage({ role: "tool", content: "💬 Synthesizing grounded answer...", toolName: "synthesis" });

    const synthesisPrompt = [
      "You are a research assistant that answers questions based ONLY on the provided evidence.",
      "RULES:",
      "1. Base your answer ONLY on the evidence below. Do NOT use background knowledge.",
      "2. If the evidence is insufficient, say so explicitly.",
      "3. Cite sources when making claims (mention the source title/URL).",
      "4. Be concise but comprehensive.",
      `5. Tools used to gather evidence: ${toolsUsed.join(", ")}`,
    ].join("\n");

    const result = await callTool("chat", {
      message: `Question: ${userQuery}\n\n---EVIDENCE---\n${evidence.slice(0, 12000)}`,
      history: [{ role: "system", content: synthesisPrompt }],
    });

    if (controller.signal.aborted) return "";

    return result.content.map(c => c.text ?? `[${c.type}]`).join("\n");
  }, [callTool, settings.ai_api_key, addMessage]);

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

      // Classify intent
      const intent = classifyIntent(text, history, { rendererAvailable });

      // Show routing reasoning
      addMessage({
        role: "tool",
        content: `🧭 ${intent.reasoning}`,
        toolName: "router",
      });

      // Execute tool actions
      const toolResults: Array<{ tool: string; result: ToolCallResult; duration: number }> = [];

      for (const action of intent.actions) {
        if (controller.signal.aborted) break;

        // For chat tool, inject history
        if (action.tool === "chat" && "message" in action.args) {
          (action.args as any).history = history;
        }

        const execResult = await executeTool(action, controller);
        if (execResult) {
          toolResults.push({ tool: action.tool, ...execResult });
        }
      }

      if (controller.signal.aborted) return;

      // If no results, bail
      if (toolResults.length === 0) {
        addMessage({ role: "assistant", content: "No results returned." });
        return;
      }

      const lastResult = toolResults[toolResults.length - 1];
      const resultText = lastResult.result.content.map(c => c.text ?? `[${c.type}]`).join("\n");

      // Synthesis step: if we gathered evidence and need to synthesize
      if (intent.synthesize && !lastResult.result.isError && settings.ai_api_key) {
        const toolsUsed = toolResults.map(r => r.tool);
        const evidence = toolResults
          .filter(r => r.tool !== "chat")
          .map(r => r.result.content.map(c => c.text ?? "").join("\n"))
          .join("\n\n---\n\n");

        if (evidence.length > 100) {
          const synthesized = await synthesizeFromEvidence(text, evidence, toolsUsed, controller);
          if (controller.signal.aborted) return;
          if (synthesized) {
            addMessage({ role: "assistant", content: synthesized });
            return;
          }
        }
      }

      // For async job tools, format nicely
      if (["crawl", "batch_scrape", "agent"].includes(lastResult.tool)) {
        try {
          const parsed = JSON.parse(resultText);
          if (parsed.jobId) {
            const statusTool = lastResult.tool === "crawl" ? "check_crawl_status" :
                               lastResult.tool === "batch_scrape" ? "check_batch_status" : "agent_status";
            addMessage({
              role: "assistant",
              content: `✅ **Job started!**\n\n**Job ID:** \`${parsed.jobId}\`\n**Status:** ${parsed.status}\n\nI'll check the status for you. You can also paste the job ID or use \`/status ${parsed.jobId}\` to check manually.`,
            });

            // Auto-poll once after a few seconds for quick jobs
            if (lastResult.tool !== "agent") {
              setTimeout(async () => {
                if (controller.signal.aborted) return;
                const statusResult = await callTool(statusTool, { jobId: parsed.jobId });
                const statusText = statusResult.content.map(c => c.text ?? "").join("\n");
                try {
                  const statusData = JSON.parse(statusText);
                  if (statusData.status === "completed") {
                    addMessage({ role: "assistant", content: `✅ **Job completed!**\n\n\`\`\`json\n${JSON.stringify(statusData, null, 2).slice(0, 3000)}\n\`\`\`` });
                  } else {
                    addMessage({ role: "tool", content: `⏳ Job still ${statusData.status}. Check again with /status ${parsed.jobId}`, toolName: statusTool });
                  }
                } catch {
                  addMessage({ role: "assistant", content: statusText.slice(0, 3000) });
                }
              }, 5000);
            }
            return;
          }
        } catch { /* not JSON, fall through */ }
      }

      // Regular result display
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto space-y-3 scrollbar-cyber pr-2 mb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground/60 font-mono">
                Tools-first AI assistant — 15 MCP tools at your service
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
          <div
            key={msg.id}
            className={cn("flex gap-3", msg.role === "user" && "justify-end")}
          >
            {msg.role !== "user" && (
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "tool" ? "bg-cyber-violet/20 text-cyber-violet" : "bg-primary/20 text-primary"
              )}>
                {msg.role === "tool" ? <Wrench className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </div>
            )}
            <div
              className={cn(
                "rounded-lg px-4 py-2.5 max-w-[80%] text-sm",
                msg.role === "user"
                  ? "bg-primary/15 text-foreground"
                  : msg.role === "tool"
                  ? "bg-cyber-violet/5 border border-cyber-violet/20 text-muted-foreground text-xs font-mono"
                  : "glass text-foreground"
              )}
            >
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

        {/* Thinking indicator */}
        {loading && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <div className="glass rounded-lg px-4 py-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {currentStep || "🤖 Processing..."}
                </span>
              </div>
              {elapsed > 5 && (
                <p className="text-[10px] text-cyber-amber font-mono">
                  Still working... ({elapsed.toFixed(0)}s)
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="relative glass rounded-lg p-3 flex gap-2">
        <SlashCommandPicker
          input={input}
          visible={showSlashPicker && input.startsWith("/") && !input.includes(" ")}
          onSelect={(cmd) => {
            setInput(cmd);
            setShowSlashPicker(false);
          }}
          onDismiss={() => setShowSlashPicker(false)}
        />
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSlashPicker(e.target.value.startsWith("/"));
          }}
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
            onClick={handleSend}
            disabled={!input.trim()}
            size="icon"
            className="shrink-0 bg-primary text-primary-foreground"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
