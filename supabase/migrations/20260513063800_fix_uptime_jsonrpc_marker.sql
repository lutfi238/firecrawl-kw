-- Correct the body_contains marker for the MCP JSON-RPC uptime target.
-- WWW-Authenticate is a response header, not visible in the response body.
update public.uptime_targets
set body_contains = 'Unauthorized'
where name = 'MCP JSON-RPC tools/list';
