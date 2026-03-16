import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useMCPServer } from "@/hooks/useMCPServer";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Bot, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCallResult } from "@/types/mcp";
import { TOOL_DEFINITIONS } from "@/types/tools";

const SLASH_COMMANDS = TOOL_DEFINITIONS.map((t) => `/${t.name}`);

export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const { callTool } = useMCPServer();
  const { githubToken } = useAuthStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const addMessage = (msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    addMessage({ role: "user", content: text });

    // Check for slash commands
    const match = text.match(/^\/(\w+)\s*(.*)/);
    if (match) {
      const toolName = match[1];
      const argText = match[2].trim();
      const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);

      if (tool) {
        setLoading(true);
        // Build args from first required field
        const args: Record<string, unknown> = {};
        const firstRequired = tool.inputs.find((i) => i.required);
        if (firstRequired) {
          args[firstRequired.name] = argText;
        }

        addMessage({ role: "tool", content: `Executing ${toolName}...`, toolName, toolInput: args });

        const result = await callTool(toolName, args);
        const resultText = result.content.map((c) => c.text ?? `[${c.type}]`).join("\n");

        addMessage({
          role: "assistant",
          content: resultText,
          toolName,
          toolOutput: result,
        });
        setLoading(false);
        return;
      }
    }

    // Non-slash: use extract with AI if token available
    if (githubToken) {
      setLoading(true);
      addMessage({ role: "tool", content: "Thinking with AI...", toolName: "extract" });

      const result = await callTool("extract", {
        url: "https://example.com",
        prompt: text,
      });
      const resultText = result.content.map((c) => c.text ?? `[${c.type}]`).join("\n");
      addMessage({ role: "assistant", content: resultText });
      setLoading(false);
    } else {
      addMessage({
        role: "assistant",
        content: "No GitHub token available. Use slash commands (e.g. `/search your query`) to run tools directly, or re-authenticate in Settings to enable AI chat.",
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
                Use slash commands: {SLASH_COMMANDS.slice(0, 4).join(", ")}...
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3",
              msg.role === "user" && "justify-end"
            )}
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
        {loading && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <div className="glass rounded-lg px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Processing...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="glass rounded-lg p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="/search query or ask a question..."
          className="bg-transparent border-none font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={loading}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          size="icon"
          className="shrink-0 bg-primary text-primary-foreground"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
