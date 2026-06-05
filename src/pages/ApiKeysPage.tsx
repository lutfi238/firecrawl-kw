import { useState, useEffect, useCallback } from "react";
import { useMCPServer } from "@/hooks/useMCPServer";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  status: "active" | "revoked";
}

interface CreatedKeyResponse {
  id: string;
  name: string;
  fullKey: string;
  key_prefix: string;
  warning?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseJsonFromToolResult(text: string): unknown {
  // Try direct JSON parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code block
    const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

// ─── Main Component ──────────────────────────────────────────────────

export default function ApiKeysPage() {
  const { callTool, loading: mcpLoading } = useMCPServer();

  // State
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("Default Secret");
  const [createdKey, setCreatedKey] = useState<CreatedKeyResponse | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRecord | null>(null);
  const [editName, setEditName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch keys ───────────────────────────────────────────────────

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callTool("api_key_manage", { action: "list" });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to load MCP secrets", { description: text });
        return;
      }
      const text = result.content.map((c) => c.text ?? "").join("\n");
      const parsed = parseJsonFromToolResult(text);
      // Handle both { keys: [...] } and direct array formats
      const keyList = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.keys;
      if (Array.isArray(keyList)) {
        // Derive status from revoked_at (API doesn't send a status field)
        const normalized = keyList.map((k) => ({
          ...k,
          status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
        }));
        setKeys(normalized);
      } else {
        toast.error("Unexpected response format from API");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to load MCP secrets", { description: message });
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  // ── Create secret ────────────────────────────────────────────────

  const handleCreateKey = async () => {
    setShowCreateDialog(true);
    setCreatedKey(null);
    setCreating(true);
    try {
      const result = await callTool("api_key_manage", {
        action: "create",
        name: newKeyName.trim() || "Default Secret",
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to create MCP secret", { description: text });
        setShowCreateDialog(false);
        return;
      }
      const text = result.content.map((c) => c.text ?? "").join("\n");
      const parsed = parseJsonFromToolResult(text) as CreatedKeyResponse | null;
      if (parsed && parsed.fullKey) {
        // Auto-copy the full secret to clipboard
        await navigator.clipboard.writeText(parsed.fullKey).catch(() => {});
        setCreatedKey(parsed);
        setEditName(parsed.name);
        toast.success("MCP secret created and copied to clipboard");
        // Refresh the list
        await fetchKeys();
      } else {
        toast.error("Failed to parse created key response");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to create MCP secret", { description: message });
    } finally {
      setCreating(false);
    }
  };

  // ── Copy secret ──────────────────────────────────────────────────

  const copyToClipboard = async (
    text: string,
    id: string,
    successMessage = "Copied to clipboard",
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(successMessage);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  // ── Rename secret ────────────────────────────────────────────────

  const handleRenameCreatedKey = async () => {
    if (!createdKey || !editName.trim()) return;
    setRenamingId(createdKey.id);
    try {
      const name = editName.trim();
      const result = await callTool("api_key_manage", {
        action: "rename",
        keyId: createdKey.id,
        name,
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to rename MCP secret", { description: text });
        return;
      }
      toast.success("MCP secret renamed successfully");
      setCreatedKey((prev) => (prev ? { ...prev, name } : null));
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to rename MCP secret", { description: message });
    } finally {
      setRenamingId(null);
    }
  };


  // ── Delete secret ────────────────────────────────────────────────

  const handleDeleteKey = async (keyId: string) => {
    setDeletingId(keyId);
    try {
      const result = await callTool("api_key_manage", {
        action: "delete",
        keyId,
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to delete MCP secret", { description: text });
        return;
      }
      toast.success("MCP secret deleted successfully");
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to delete MCP secret", { description: message });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 max-w-6xl">
        <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
          MCP SECRETS
        </h1>
        <GlassCard className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </GlassCard>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
          MCP SECRETS
        </h1>
        <Button
          onClick={handleCreateKey}
          disabled={creating || mcpLoading}
          className="gap-2 text-xs font-mono bg-primary/90 hover:bg-primary text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Generate MCP Secret
        </Button>

        {/* Create Key Dialog */}
        <Dialog
          open={showCreateDialog}
          onOpenChange={(open) => {
            setShowCreateDialog(open);
            if (!open) setCreatedKey(null);
          }}
        >
          <DialogContent className="bg-card border-border max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-4 w-4 text-cyan-400" />
                {createdKey ? "Secret Created" : "Generating..."}
              </DialogTitle>
              <DialogDescription>
                {createdKey
                  ? "Copy this MCP secret and store it securely. It will not be shown again."
                  : "Generating a new per-user MCP secret..."}
              </DialogDescription>
            </DialogHeader>

            {createdKey && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label
                    htmlFor="created-secret-name"
                    className="text-xs font-mono text-muted-foreground"
                  >
                    Secret Name
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="created-secret-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Secret name"
                      className="font-mono text-sm bg-background/50 border-border flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCreatedKey();
                      }}
                    />
                    <Button
                      onClick={handleRenameCreatedKey}
                      disabled={renamingId === createdKey.id || !editName.trim()}
                      size="sm"
                      className="shrink-0 text-xs"
                    >
                      {renamingId === createdKey.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Save Name"
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground">
                    Full MCP Secret
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 text-xs font-mono bg-background/50 rounded-md px-3 py-2 border border-border/50 break-all select-all">
                      {createdKey.fullKey}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => copyToClipboard(createdKey.fullKey, "new")}
                    >
                      {copiedId === "new" ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={() => {
                  setShowCreateDialog(false);
                  setCreatedKey(null);
                }}
                className="text-xs"
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



        {/* Delete Confirmation Dialog */}
        <Dialog
          open={!!deleteTarget}
          onOpenChange={() => setDeleteTarget(null)}
        >
          <DialogContent className="bg-card border-border max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete MCP Secret?
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete{" "}
                <span className="font-mono text-foreground">
                  {deleteTarget?.name}
                </span>
                ? This will permanently remove the secret and any service using
                it will stop working immediately.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!deleteTarget) return;
                  await handleDeleteKey(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                disabled={!!deleteTarget && deletingId === deleteTarget.id}
                className="text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteTarget && deletingId === deleteTarget.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    Deleting...
                  </>
                ) : (
                  "Yes, Delete"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Secrets table */}
      {keys.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm text-muted-foreground mb-1 font-medium">
            No MCP secrets yet
          </p>
          <p className="text-xs text-muted-foreground/70">
            Generate your first per-user secret to connect MCP clients.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="p-0 overflow-hidden" glow="cyan">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Name
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Secret Prefix
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                  Created
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                  Last Used
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground text-center">
                  Status
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium text-sm">
                    <span className="font-mono text-xs">{key.name}</span>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono bg-background/50 rounded px-2 py-1 border border-border/50">
                      {key.key_prefix}
                      <span className="text-muted-foreground">...</span>
                    </code>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(key.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(key.last_used_at)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        key.status === "active" ? "default" : "destructive"
                      }
                      className={`text-[10px] font-mono uppercase tracking-wider ${
                        key.status === "active"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                          : ""
                      }`}
                    >
                      {key.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(key)}
                      aria-label={`Delete ${key.name}`}
                      title={`Delete ${key.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GlassCard>
      )}
    </div>
  );
}
