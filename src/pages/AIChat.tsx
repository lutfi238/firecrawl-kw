import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useMCPServer } from "@/hooks/useMCPServer";
import { useSettings } from "@/hooks/useSettings";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Bot, User, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCallResult } from "@/types/mcp";
import { TOOL_DEFINITIONS } from "@/types/tools";
import { supabase } from "@/integrations/supabase/client";
import { SlashCommandPicker } from "@/components/SlashCommandPicker";

export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { callTool } = useMCPServer();
  const { settings } = useSettings();
  const { githubToken } = useAuthStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showSlashPicker, setShowSlashPicker] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Elapsed timer
  useEffect(() => {
    if (!loading || !loadingStartedAt) return;
    const interval = setInterval(() => setElapsed((Date.now() - loadingStartedAt) / 1000), 100);
    return () => clearInterval(interval);
  }, [loading, loadingStartedAt]);

  const addMessage = (msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  };

  const providerLabel = settings.ai_provider || "AI";
  const modelLabel = settings.ai_model || "";

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setLoadingStartedAt(null);
    addMessage({ role: "assistant", content: "⚠️ Request cancelled." });
  }, []);

  const logToMonitor = async (toolName: string, input: Record<string, unknown>, output: ToolCallResult, duration: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("mcp_logs").insert({
          user_id: user.id,
          tool: toolName,
          input: input as any,
          output: output as any,
          status: output.isError ? "error" : "success",
          duration_ms: duration,
        });
      }
    } catch { /* don't block */ }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    addMessage({ role: "user", content: text });

    const controller = new AbortController();
    abortRef.current = controller;

    // Check for slash commands
    const match = text.match(/^\/(\w+)\s*(.*)/);
    if (match) {
      const toolName = match[1];
      const argText = match[2].trim();
      const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);

      if (tool) {
        setLoading(true);
        setLoadingStartedAt(Date.now());
        const args: Record<string, unknown> = {};
        const firstRequired = tool.inputs.find((i) => i.required);
        if (firstRequired) args[firstRequired.name] = argText;

        addMessage({ role: "tool", content: `Executing ${toolName}...`, toolName, toolInput: args });

        // Timeout
        const timeout = setTimeout(() => {
          controller.abort();
          setLoading(false);
          setLoadingStartedAt(null);
          addMessage({ role: "assistant", content: "⏱️ Request timed out after 30s. Check your API key and Base URL in Settings." });
        }, 30000);

        const start = Date.now();
        const result = await callTool(toolName, args);
        clearTimeout(timeout);

        if (controller.signal.aborted) return;

        const duration = Date.now() - start;
        const resultText = result.content.map((c) => c.text ?? `[${c.type}]`).join("\n");
        console.log("[AIChat] Tool result:", JSON.stringify(result));
        addMessage({ role: result.isError ? "tool" : "assistant", content: resultText, toolName, toolOutput: result });
        await logToMonitor(toolName, args, result, duration);

        setLoading(false);
        setLoadingStartedAt(null);
        return;
      }
    }

    // Non-slash: send as regular chat to AI provider
    if (settings.ai_api_key) {
      setLoading(true);
      setLoadingStartedAt(Date.now());
      addMessage({ role: "tool", content: `Using ${providerLabel} → ${modelLabel}`, toolName: "ai" });

      const timeout = setTimeout(() => {
        controller.abort();
        setLoading(false);
        setLoadingStartedAt(null);
        addMessage({ role: "assistant", content: "⏱️ Request timed out after 30s. Check your API key and Base URL in Settings." });
      }, 30000);

      const start = Date.now();
      // Build conversation history from recent messages (last 10 user/assistant messages)
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      
      const result = await callTool("chat", { message: text, history });
      clearTimeout(timeout);

      if (controller.signal.aborted) return;

      const duration = Date.now() - start;
      const resultText = result.content.map((c) => c.text ?? `[${c.type}]`).join("\n");
      console.log("[AIChat] Chat result:", JSON.stringify(result));
      addMessage({ role: result.isError ? "tool" : "assistant", content: resultText });
      await logToMonitor("ai_chat", { prompt: text }, result, duration);

      setLoading(false);
      setLoadingStartedAt(null);
    } else {
      addMessage({
        role: "assistant",
        content: "No AI provider configured. Go to Settings → AI Provider to add your API key, or use slash commands (e.g. `/search your query`).",
      });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl">
      <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber mb-4">AI CHAT</h1>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto space-y-3 scrollbar-cyber pr-2 mb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground/50 font-mono">
                Use slash commands: /search, /scrape, /extract, /crawl...
              </p>
              {settings.ai_provider && (
                <p className="text-[11px] text-muted-foreground/30 font-mono">
                  AI: {settings.ai_provider} → {settings.ai_model}
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
                  🤖 Thinking
                  <span className="inline-flex w-6">
                    <span className="animate-pulse">...</span>
                  </span>
                </span>
              </div>
              {providerLabel && settings.ai_api_key && (
                <p className="text-[10px] text-muted-foreground/50 font-mono">
                  Using {providerLabel} → {modelLabel}
                </p>
              )}
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
            if (e.target.value.startsWith("/")) {
              setShowSlashPicker(true);
            } else {
              setShowSlashPicker(false);
            }
          }}
          onKeyDown={(e) => {
            if (showSlashPicker && input.startsWith("/") && !input.includes(" ")) {
              if (["ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
              if (e.key === "Enter") return; // let picker handle it
            }
            if (e.key === "Enter" && !e.shiftKey) handleSend();
          }}
          placeholder="/search query or ask a question..."
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
