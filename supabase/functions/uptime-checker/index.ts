// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Target {
  id: string;
  name: string;
  kind: string;
  url: string;
  method: string;
  expected_status_code: number;
  body_contains: string | null;
  enabled: boolean;
  threshold_degraded_ms: number;
  threshold_down_ms: number;
}

interface CheckResult {
  status: "up" | "degraded" | "down";
  responseMs: number;
  statusCode: number;
  retryCount: number;
  bodyExcerpt: string | null;
  error: string | null;
}

const REQUEST_TIMEOUT_MS = 8_000;
const MIN_GLOBAL_INTERVAL_MS = 30_000; // hard rate limit per server-wide invocation
const BODY_EXCERPT_BYTES = 400;

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildRequest(target: Target): RequestInit {
  if (target.method === "POST" && target.kind === "mcp_jsonrpc") {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    };
  }
  return {
    method: target.method || "GET",
    headers: { Accept: "application/json,text/html,*/*" },
  };
}

async function performSingleCheck(target: Target): Promise<CheckResult> {
  const init = buildRequest(target);
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(target.url, init, REQUEST_TIMEOUT_MS);
    const elapsed = Date.now() - start;
    const text = await res.text();

    const expectedStatus = target.expected_status_code;
    const statusOk = res.status === expectedStatus;
    const bodyOk = target.body_contains
      ? text.includes(target.body_contains)
      : true;
    const slowEnoughForDegraded = elapsed > target.threshold_degraded_ms;
    const slowEnoughForDown = elapsed > target.threshold_down_ms;

    let status: CheckResult["status"];
    if (!statusOk || !bodyOk || slowEnoughForDown) {
      status = "down";
    } else if (slowEnoughForDegraded) {
      status = "degraded";
    } else {
      status = "up";
    }

    return {
      status,
      responseMs: elapsed,
      statusCode: res.status,
      retryCount: 0,
      bodyExcerpt: text.slice(0, BODY_EXCERPT_BYTES) || null,
      error: !statusOk
        ? `unexpected status ${res.status}, expected ${expectedStatus}`
        : !bodyOk
          ? `missing expected body marker`
          : slowEnoughForDown
            ? `latency exceeded down threshold (${elapsed}ms)`
            : null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      status: "down",
      responseMs: elapsed,
      statusCode: 0,
      retryCount: 0,
      bodyExcerpt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function performCheckWithRetry(target: Target): Promise<CheckResult> {
  const first = await performSingleCheck(target);
  if (first.status !== "down") return first;

  // 1 retry only when down to absorb transient blips
  await new Promise((r) => setTimeout(r, 750));
  const retry = await performSingleCheck(target);
  retry.retryCount = 1;
  return retry;
}

async function notifyOnStatusChange(
  supabase: ReturnType<typeof getServiceClient>,
  target: Target,
  result: CheckResult,
): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) return;

  // Look up the previous status for this target.
  const { data: previous } = await supabase
    .from("uptime_logs")
    .select("status")
    .eq("target_id", target.id)
    .order("checked_at", { ascending: false })
    .limit(1);

  const previousStatus = previous?.[0]?.status ?? "unknown";
  if (previousStatus === result.status) return;

  // Only emit on transitions involving down or degraded
  const interesting =
    result.status === "down" ||
    result.status === "degraded" ||
    previousStatus === "down" ||
    previousStatus === "degraded";
  if (!interesting) return;

  const emoji =
    result.status === "up" ? "🟢" : result.status === "degraded" ? "🟠" : "🔴";

  const content = [
    `${emoji} **${target.name}** is now \`${result.status.toUpperCase()}\``,
    `Previous: \`${previousStatus}\``,
    `URL: ${target.url}`,
    `Latency: ${result.responseMs}ms (status ${result.statusCode})`,
    result.error ? `Error: ${result.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch (err) {
    console.warn("[uptime-checker] webhook failed:", (err as Error).message);
  }
}

let lastInvocationAt = 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cheap in-memory rate limit guard so a misbehaving cron can't hammer endpoints.
  const now = Date.now();
  if (now - lastInvocationAt < MIN_GLOBAL_INTERVAL_MS) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "rate_limited" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  lastInvocationAt = now;

  try {
    const supabase = getServiceClient();

    // Optional manual override for ?target=<id|name>
    const url = new URL(req.url);
    const targetParam = url.searchParams.get("target");

    let query = supabase.from("uptime_targets").select("*").eq("enabled", true);

    if (targetParam) {
      query = query.or(`id.eq.${targetParam},name.eq.${targetParam}`);
    }

    const { data: targets, error: targetErr } = await query;
    if (targetErr) throw targetErr;

    // Fallback to MCP-only legacy behavior if there are no configured targets yet.
    const legacyMode = !targets || targets.length === 0;
    const checkList: Target[] = legacyMode
      ? [
          {
            id: "00000000-0000-0000-0000-000000000000",
            name: "MCP Health",
            kind: "mcp_health",
            url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mcp-server`,
            method: "GET",
            expected_status_code: 200,
            body_contains: '"status":"ok"',
            enabled: true,
            threshold_degraded_ms: 1500,
            threshold_down_ms: 8000,
          },
        ]
      : (targets as Target[]);

    const results: Array<{
      target: string;
      status: string;
      response_ms: number;
      status_code: number;
      retry_count: number;
      error: string | null;
    }> = [];

    for (const target of checkList) {
      const result = await performCheckWithRetry(target);

      // Insert log row
      const insert: Record<string, unknown> = {
        status: result.status,
        response_ms: result.responseMs,
        status_code: result.statusCode,
        checked_at: new Date().toISOString(),
        error: result.error,
        retry_count: result.retryCount,
        body_excerpt: result.bodyExcerpt,
      };
      if (!legacyMode) insert.target_id = target.id;

      const { error: insertErr } = await supabase
        .from("uptime_logs")
        .insert(insert);

      if (insertErr) {
        console.error(
          "[uptime-checker] insert failed for",
          target.name,
          insertErr.message,
        );
      }

      if (!legacyMode) {
        await notifyOnStatusChange(supabase, target, result);
      }

      results.push({
        target: target.name,
        status: result.status,
        response_ms: result.responseMs,
        status_code: result.statusCode,
        retry_count: result.retryCount,
        error: result.error,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[uptime-checker] Error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
