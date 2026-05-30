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
  MoreVertical,
  Eye,
  EyeOff,
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
  const [newKeyName, setNewKeyName] = useState("Default Key");
  const [createdKey, setCreatedKey] = useState<CreatedKeyResponse | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<ApiKeyRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRecord | null>(null);
  const [showPrefix, setShowPrefix] = useState(false);
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
        toast.error("Failed to load API keys", { description: text });
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
      toast.error("Failed to load API keys", { description: message });
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  // ── Create key ───────────────────────────────────────────────────

  const handleCreateKey = async () => {
    setShowCreateDialog(true);
    setCreatedKey(null);
    setCreating(true);
    try {
      const result = await callTool("api_key_manage", {
        action: "create",
        name: newKeyName.trim() || "Default Key",
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to create API key", { description: text });
        setShowCreateDialog(false);
        return;
      }
      const text = result.content.map((c) => c.text ?? "").join("\n");
      const parsed = parseJsonFromToolResult(text) as CreatedKeyResponse | null;
      if (parsed && parsed.fullKey) {
        // Auto-copy the full key to clipboard
        await navigator.clipboard.writeText(parsed.fullKey).catch(() => {});
        setCreatedKey(parsed);
        toast.success("API key created — copied to clipboard!");
        // Refresh the list
        await fetchKeys();
      } else {
        toast.error("Failed to parse created key response");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to create API key", { description: message });
    } finally {
      setCreating(false);
    }
  };

  // ── Copy key ─────────────────────────────────────────────────────

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  // ── Rename key ───────────────────────────────────────────────────

  const handleRenameKey = async () => {
    if (!detailKey || !editName.trim()) return;
    setRenamingId(detailKey.id);
    try {
      const result = await callTool("api_key_manage", {
        action: "rename",
        keyId: detailKey.id,
        name: editName.trim(),
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to rename API key", { description: text });
        return;
      }
      toast.success("API key renamed successfully");
      setDetailKey((prev) =>
        prev ? { ...prev, name: editName.trim() } : null,
      );
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to rename API key", { description: message });
    } finally {
      setRenamingId(null);
    }
  };

  const openDetailDialog = (key: ApiKeyRecord) => {
    setDetailKey(key);
    setShowPrefix(false);
    setEditName(key.name);
  };

  // ── Delete key ───────────────────────────────────────────────────

  const handleDeleteKey = async (keyId: string) => {
    setDeletingId(keyId);
    try {
      const result = await callTool("api_key_manage", {
        action: "delete",
        keyId,
      });
      if (result.isError) {
        const text = result.content.map((c) => c.text ?? "").join("\n");
        toast.error("Failed to delete API key", { description: text });
        return;
      }
      toast.success("API key deleted successfully");
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to delete API key", { description: message });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 max-w-6xl">
        <h1 className="font-display text-xl font-bold tracking-wider text-gradient-cyber">
          API KEYS
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
          API KEYS
        </h1>
        <Button
          onClick={handleCreateKey}
          disabled={creating || mcpLoading}
          className="gap-2 text-xs font-mono bg-primary/90 hover:bg-primary text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Generate New Key
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
                {createdKey ? "Key Created" : "Generating..."}
              </DialogTitle>
              <DialogDescription>
                {createdKey
                  ? "Copy this key and store it securely. It will not be shown again."
                  : "Generating a new API key..."}
              </DialogDescription>
            </DialogHeader>

            {createdKey && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-muted-foreground">
                    Key Name
                  </label>
                  <p className="text-sm font-medium mt-1">{createdKey.name}</p>
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground">
                    Full API Key
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

        {/* Key Detail Dialog */}
        <Dialog open={!!detailKey} onOpenChange={() => setDetailKey(null)}>
          <DialogContent className="bg-card border-border max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-4 w-4 text-cyan-400" />
                API Key Details
              </DialogTitle>
              <DialogDescription>
                View and manage this API key. The full key is only shown once
                during creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Key Name (editable inline) */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground">
                  Name
                </label>
                <div className="flex gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Key name"
                    className="font-mono text-sm bg-background/50 border-border flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameKey();
                    }}
                  />
                  <Button
                    onClick={handleRenameKey}
                    disabled={renamingId === detailKey?.id || !editName.trim()}
                    size="sm"
                    className="shrink-0 text-xs"
                  >
                    {renamingId === detailKey?.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>

              {/* Key Prefix with eye toggle */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground">
                  Key Prefix
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-background/50 rounded-md px-3 py-2 border border-border/50 break-all select-all">
                    {showPrefix
                      ? detailKey?.key_prefix
                      : detailKey?.key_prefix.slice(0, 12) + "..."}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPrefix(!showPrefix)}
                    title={showPrefix ? "Hide key" : "Show key"}
                  >
                    {showPrefix ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      copyToClipboard(
                        detailKey!.key_prefix,
                        detailKey!.id + "-prefix",
                      )
                    }
                    title="Copy prefix"
                  >
                    {copiedId === detailKey?.id + "-prefix" ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Status
                  </label>
                  <Badge
                    variant={
                      detailKey?.status === "active" ? "default" : "destructive"
                    }
                    className={`text-[10px] font-mono uppercase ${
                      detailKey?.status === "active"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-destructive/20 text-destructive border-destructive/30"
                    }`}
                  >
                    {detailKey?.status}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Created
                  </label>
                  <p className="text-xs font-mono text-foreground">
                    {formatDate(detailKey?.created_at ?? "")}
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Last Used
                  </label>
                  <p className="text-xs font-mono text-foreground">
                    {formatDate(detailKey?.last_used_at)}
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Key ID
                  </label>
                  <p className="text-[10px] font-mono text-muted-foreground break-all">
                    {detailKey?.id.slice(0, 8)}...
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => detailKey && setDeleteTarget(detailKey)}
                className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
              <Button
                variant="outline"
                onClick={() => setDetailKey(null)}
                className="text-xs"
              >
                Close
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
                Delete API Key?
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete{" "}
                <span className="font-mono text-foreground">
                  {deleteTarget?.name}
                </span>
                ? This will permanently remove the key and any service using it
                will stop working immediately.
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
                  setDetailKey(null);
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

      {/* Keys table */}
      {keys.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm text-muted-foreground mb-1 font-medium">
            No API keys yet
          </p>
          <p className="text-xs text-muted-foreground/70">
            Generate your first key to get started.
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
                  Key Prefix
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
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => openDetailDialog(key)}
                      title="View details"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
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
