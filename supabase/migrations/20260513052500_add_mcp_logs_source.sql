-- Add source column to mcp_logs so we can distinguish dashboard vs claude vs zed vs other clients
ALTER TABLE public.mcp_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'dashboard';

CREATE INDEX IF NOT EXISTS idx_mcp_logs_source ON public.mcp_logs(source);
