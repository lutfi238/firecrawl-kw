
CREATE TABLE public.mcp_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input jsonb,
  output jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own jobs"
ON public.mcp_jobs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own jobs"
ON public.mcp_jobs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own jobs"
ON public.mcp_jobs FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_mcp_jobs_updated_at
  BEFORE UPDATE ON public.mcp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
