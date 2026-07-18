create table if not exists public.mcp_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (bucket_key, window_start)
);

create index if not exists mcp_rate_limits_expires_at_idx
  on public.mcp_rate_limits (expires_at);

alter table public.mcp_rate_limits enable row level security;
revoke all on table public.mcp_rate_limits from public, anon, authenticated;

create or replace function public.consume_mcp_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_request_count integer;
begin
  if p_bucket_key is null or length(p_bucket_key) < 3 or length(p_bucket_key) > 200 then
    raise exception 'invalid rate-limit bucket key';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate-limit window';
  end if;
  if p_max_requests < 1 or p_max_requests > 10000 then
    raise exception 'invalid rate-limit maximum';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  insert into public.mcp_rate_limits (
    bucket_key,
    window_start,
    request_count,
    expires_at
  ) values (
    p_bucket_key,
    v_window_start,
    1,
    v_window_end + interval '5 minutes'
  )
  on conflict (bucket_key, window_start)
  do update set
    request_count = public.mcp_rate_limits.request_count + 1,
    expires_at = excluded.expires_at
  returning request_count into v_request_count;

  if random() < 0.01 then
    delete from public.mcp_rate_limits where expires_at < v_now;
  end if;

  return query select
    v_request_count <= p_max_requests,
    greatest(p_max_requests - v_request_count, 0),
    greatest(ceil(extract(epoch from (v_window_end - v_now)))::integer, 1);
end;
$$;

revoke all on function public.consume_mcp_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_mcp_rate_limit(text, integer, integer)
  to service_role;
