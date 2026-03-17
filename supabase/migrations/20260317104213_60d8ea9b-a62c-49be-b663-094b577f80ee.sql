
CREATE TABLE public.uptime_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'up',
  response_ms integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.uptime_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read uptime logs"
  ON public.uptime_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert uptime logs"
  ON public.uptime_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
