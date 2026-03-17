import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

const SLASH_COMMANDS = [
  { command: "/search", description: "Search the web", example: "/search latest AI news", icon: "🔍" },
  { command: "/scrape", description: "Scrape a URL to markdown", example: "/scrape https://example.com", icon: "🕷️" },
  { command: "/scrape_js", description: "Scrape JS-heavy sites", example: "/scrape_js https://spa-site.com", icon: "⚡" },
  { command: "/crawl", description: "Crawl entire website", example: "/crawl https://docs.example.com", icon: "🕸️" },
  { command: "/map", description: "Map all URLs on a site", example: "/map https://example.com", icon: "🗺️" },
  { command: "/extract", description: "Extract structured data with AI", example: "/extract https://example.com get all prices", icon: "🤖" },
  { command: "/screenshot", description: "Screenshot a webpage", example: "/screenshot https://example.com", icon: "📸" },
  { command: "/batch", description: "Scrape multiple URLs", example: "/batch url1, url2, url3", icon: "📦" },
  { command: "/html", description: "Convert HTML to Markdown", example: "/html <h1>Hello</h1>", icon: "🔄" },
];

interface SlashCommandPickerProps {
  input: string;
  onSelect: (command: string) => void;
  onDismiss: () => void;
  visible: boolean;
}

export function SlashCommandPicker({ input, onSelect, onDismiss, visible }: SlashCommandPickerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = SLASH_COMMANDS.filter((c) =>
    c.command.startsWith(input.split(" ")[0].toLowerCase())
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [input]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.children[activeIndex] as HTMLElement;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        onSelect(filtered[activeIndex].command + " ");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    },
    [visible, filtered, activeIndex, onSelect, onDismiss]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 right-0 mb-2 z-50",
        "animate-fade-in"
      )}
    >
      <div className="glass rounded-lg border border-border/50 shadow-[0_0_20px_hsl(var(--primary)/0.1)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-3 text-xs font-mono text-muted-foreground/50 text-center">
            No commands found
          </div>
        ) : (
          <div ref={listRef} className="max-h-[220px] overflow-y-auto scrollbar-cyber">
            {filtered.map((cmd, i) => (
              <button
                key={cmd.command}
                onClick={() => onSelect(cmd.command + " ")}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100",
                  i === activeIndex
                    ? "bg-primary/10 border-l-2 border-l-primary shadow-[inset_0_0_12px_hsl(var(--primary)/0.05)]"
                    : "border-l-2 border-l-transparent hover:bg-muted/30"
                )}
              >
                <span className="text-base shrink-0 w-6 text-center">{cmd.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-mono font-semibold text-primary">{cmd.command}</span>
                    <span className="text-xs text-muted-foreground truncate">{cmd.description}</span>
                  </div>
                  {i === activeIndex && (
                    <p className="text-[10px] font-mono text-muted-foreground/40 mt-0.5 truncate">
                      e.g. {cmd.example}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
