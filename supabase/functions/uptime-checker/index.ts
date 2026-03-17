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

    // Ping the MCP server endpoint
    const mcpUrl = `${supabaseUrl}/functions/v1/mcp-server`;
    const start = Date.now();
    let status = "up";
    let responseMs = 0;

    try {
      const res = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "uptime-checker", version: "1.0.0" },
          },
          id: 1,
        }),
      });
      responseMs = Date.now() - start;
      if (!res.ok) status = "down";
    } catch {
      responseMs = Date.now() - start;
      status = "down";
    }

    // Store result
    const { error } = await supabase.from("uptime_logs").insert({
      status,
      response_ms: responseMs,
      checked_at: new Date().toISOString(),
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({ status, response_ms: responseMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
