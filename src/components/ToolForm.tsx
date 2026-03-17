import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";
import type { ToolDefinition } from "@/types/tools";

interface ToolFormProps {
  tool: ToolDefinition;
  onExecute: (args: Record<string, unknown>) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function ToolForm({ tool, onExecute, loading, disabled }: ToolFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    for (const input of tool.inputs) {
      if (input.default !== undefined) defaults[input.name] = input.default;
    }
    setValues(defaults);
  }, [tool.name]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const args: Record<string, unknown> = {};
    for (const input of tool.inputs) {
      const val = values[input.name];
      if (val !== undefined && val !== "" && val !== null) {
        if (input.type === "number") args[input.name] = Number(val);
        else args[input.name] = val;
      }
    }
    onExecute(args);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {tool.inputs.map((input) => (
        <div key={input.name} className="flex flex-col gap-1.5">
          <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {input.name}
            {input.required && <span className="text-cyber-red ml-1">*</span>}
          </Label>
          {input.type === "boolean" ? (
            <Switch
              checked={!!values[input.name]}
              onCheckedChange={(v) => setValues((prev) => ({ ...prev, [input.name]: v }))}
            />
          ) : input.name === "html" || input.name === "schema" ? (
            <Textarea
              value={String(values[input.name] ?? "")}
              onChange={(e) => setValues((prev) => ({ ...prev, [input.name]: e.target.value }))}
              placeholder={input.placeholder}
              className="font-mono text-sm bg-background/50 border-border min-h-[80px]"
            />
          ) : (
            <Input
              type={input.type === "number" ? "number" : "text"}
              value={String(values[input.name] ?? "")}
              onChange={(e) => setValues((prev) => ({ ...prev, [input.name]: e.target.value }))}
              placeholder={input.placeholder}
              required={input.required}
              className="font-mono text-sm bg-background/50 border-border"
            />
          )}
          <span className="text-[11px] text-muted-foreground/60">{input.description}</span>
        </div>
      ))}
      <Button type="submit" disabled={loading} className="mt-2 bg-primary text-primary-foreground gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Execute
      </Button>
    </form>
  );
}
