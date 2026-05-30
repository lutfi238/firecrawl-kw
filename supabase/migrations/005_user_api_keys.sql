-- user_api_keys: per-user API keys for REST API authentication
create table if not exists public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Default Key',
  key_hash text not null,  -- SHA-256 hash of the full key (for lookup)
  key_prefix text not null,  -- First 16 chars of the key (for display, e.g. "fc_sk-abc12345")
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_user_api_keys_user_id on public.user_api_keys(user_id);
create index if not exists idx_user_api_keys_key_hash on public.user_api_keys(key_hash) where revoked_at is null;

-- RLS: users can only see/manage their own keys
alter table public.user_api_keys enable row level security;

create policy "Users can view own keys"
  on public.user_api_keys for select
  using (auth.uid() = user_id);

create policy "Users can create own keys"
  on public.user_api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update own keys"
  on public.user_api_keys for update
  using (auth.uid() = user_id);

create policy "Users can delete own keys"
  on public.user_api_keys for delete
  using (auth.uid() = user_id);
