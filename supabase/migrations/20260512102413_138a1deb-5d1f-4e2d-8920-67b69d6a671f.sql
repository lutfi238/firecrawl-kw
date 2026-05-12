
CREATE TABLE public.oauth_clients (
  client_id text PRIMARY KEY,
  client_secret_hash text NOT NULL,
  name text NOT NULL DEFAULT 'mcp-client',
  redirect_uris text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.oauth_codes (
  code text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text,
  code_challenge_method text,
  scope text,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text UNIQUE,
  client_id text NOT NULL,
  scope text,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_tokens_access ON public.oauth_tokens(access_token_hash);
CREATE INDEX idx_oauth_tokens_refresh ON public.oauth_tokens(refresh_token_hash);

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon/authenticated. Service role bypasses RLS.
