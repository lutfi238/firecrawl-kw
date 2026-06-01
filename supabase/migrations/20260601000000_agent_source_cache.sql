create table if not exists agent_source_cache (
  url text primary key,
  content text not null,
  title text,
  freshness timestamptz,
  fetched_at timestamptz not null default now(),
  scrape_method text
);

create index if not exists idx_agent_source_cache_fetched
  on agent_source_cache (fetched_at);
