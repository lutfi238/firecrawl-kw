import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Use GET health check instead of POST initialize
    const mcpUrl = `${supabaseUrl}/functions/v1/mcp-server`;
    console.log("[uptime-checker] Pinging URL:", mcpUrl);

    const start = Date.now();
    let status = "up";
    let responseMs = 0;
    let statusCode = 0;

    try {
      const res = await fetch(mcpUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      responseMs = Date.now() - start;
      statusCode = res.status;

      const body = await res.text();
      console.log("[uptime-checker] Response status:", res.status);
      console.log("[uptime-checker] Response body:", body.slice(0, 500));

      if (!res.ok) status = "down";
    } catch (err) {
      responseMs = Date.now() - start;
      status = "down";
      console.error("[uptime-checker] Fetch error:", (err as Error).message);
    }

    console.log("[uptime-checker] Result:", { status, statusCode, responseMs });

    // Store result
    const { error } = await supabase.from("uptime_logs").insert({
      status,
      response_ms: responseMs,
      status_code: statusCode,
      checked_at: new Date().toISOString(),
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({ status, status_code: statusCode, response_ms: responseMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[uptime-checker] Error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
