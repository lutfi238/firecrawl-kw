-- Multi-target uptime monitor with scheduled checks and auto-prune.
-- Adds an uptime_targets table, extra columns on uptime_logs, and pg_cron jobs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---- Targets ----
create table if not exists public.uptime_targets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (
    kind in ('mcp_health', 'mcp_jsonrpc', 'oauth_metadata', 'frontend', 'custom')
  ),
  url text not null,
  method text not null default 'GET',
  expected_status_code int not null default 200,
  body_contains text,
  enabled boolean not null default true,
  threshold_degraded_ms int not null default 1500,
  threshold_down_ms int not null default 8000,
  check_interval_min int not null default 5,
  created_at timestamptz not null default now()
);

alter table public.uptime_targets enable row level security;

drop policy if exists "auth users can read uptime targets" on public.uptime_targets;
create policy "auth users can read uptime targets"
  on public.uptime_targets for select
  using (auth.role() = 'authenticated');

-- ---- Extend logs ----
alter table public.uptime_logs
  add column if not exists target_id uuid references public.uptime_targets(id) on delete set null,
  add column if not exists error text,
  add column if not exists retry_count int not null default 0,
  add column if not exists body_excerpt text;

create index if not exists idx_uptime_logs_target_checked
  on public.uptime_logs(target_id, checked_at desc);

-- ---- Seed default targets if empty ----
insert into public.uptime_targets (name, kind, url, method, expected_status_code, body_contains)
values
  (
    'MCP Health',
    'mcp_health',
    'https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server',
    'GET',
    200,
    '"status":"ok"'
  ),
  (
    'MCP JSON-RPC tools/list',
    'mcp_jsonrpc',
    'https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server',
    'POST',
    401,
    'WWW-Authenticate'
  ),
  (
    'OAuth Metadata',
    'oauth_metadata',
    'https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server/.well-known/oauth-authorization-server',
    'GET',
    200,
    'authorization_endpoint'
  ),
  (
    'Vercel Frontend',
    'frontend',
    'https://firecrawl-kw.vercel.app',
    'GET',
    200,
    null
  )
on conflict (name) do nothing;

-- ---- Schedule checks every 5 min ----
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'uptime-check-every-5min';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;

  perform cron.schedule(
    'uptime-check-every-5min',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/uptime-checker',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 15000
      );
    $cron$
  );
end $$;

-- ---- Auto-prune logs older than 90 days, daily at 03:00 UTC ----
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'uptime-logs-prune-daily';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;

  perform cron.schedule(
    'uptime-logs-prune-daily',
    '0 3 * * *',
    $cron$ delete from public.uptime_logs where checked_at < now() - interval '90 days' $cron$
  );
end $$;
