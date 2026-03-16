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

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // frontend origin
  const redirectUri = url.searchParams.get("redirect_uri"); // frontend origin on initial call
  const requestedScope = url.searchParams.get("scope")?.trim() || "read:user user:email copilot github_copilot_chat";

  const GITHUB_CLIENT_ID = Deno.env.get("GITHUB_CLIENT_ID");
  const GITHUB_CLIENT_SECRET = Deno.env.get("GITHUB_CLIENT_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing server configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/github-auth`;

  // ── Step 1: No code → redirect to GitHub ──
  if (!code) {
    const origin = redirectUri || req.headers.get("origin") || "http://localhost:5173";
    const ghUrl = new URL("https://github.com/login/oauth/authorize");
    ghUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
    ghUrl.searchParams.set("redirect_uri", callbackUrl);
    ghUrl.searchParams.set("scope", requestedScope);
    ghUrl.searchParams.set("state", origin);
    return new Response(null, { status: 302, headers: { Location: ghUrl.toString() } });
  }

  // ── Step 2: GitHub callback with code ──
  const frontendOrigin = state || "http://localhost:5173";

  try {
    // Exchange code for GitHub access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const githubAccessToken = tokenData.access_token;

    // Get GitHub user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: "application/json" },
    });
    const ghUser = await userRes.json();

    // Get primary email if not public
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${githubAccessToken}`, Accept: "application/json" },
      });
      const emails = await emailsRes.json();
      const primary = emails.find((e: { primary: boolean }) => e.primary) || emails[0];
      email = primary?.email;
    }
    if (!email) throw new Error("Could not retrieve email from GitHub");

    // Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const metadata = {
      avatar_url: ghUser.avatar_url,
      user_name: ghUser.login,
      full_name: ghUser.name || ghUser.login,
      provider: "github",
    };

    // Create or find user
    let userId: string;
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createErr) {
      if (!createErr.message?.toLowerCase().includes("already")) throw createErr;
      // User exists → find and update
      const { data: { users } } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = users.find((u) => u.email === email);
      if (!existing) throw new Error("User lookup failed");
      userId = existing.id;
      await supabase.auth.admin.updateUserById(userId, { user_metadata: metadata });
    } else {
      userId = newUser.user.id;
    }

    // Store GitHub token in settings table
    await supabase.from("settings").delete().match({ user_id: userId, key: "github_token" });
    await supabase.from("settings").insert({ user_id: userId, key: "github_token", value: githubAccessToken });

    // Generate magic link to establish session
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;

    const tokenHash = linkData.properties.hashed_token;

    // Redirect back to frontend with token
    const redirect = new URL(frontendOrigin);
    redirect.searchParams.set("token_hash", tokenHash);
    redirect.searchParams.set("type", "magiclink");

    return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
  } catch (err: unknown) {
    console.error("GitHub auth error:", err);
    const message = err instanceof Error ? err.message : "Authentication failed";
    const errRedirect = new URL(frontendOrigin);
    errRedirect.searchParams.set("auth_error", message);
    return new Response(null, { status: 302, headers: { Location: errRedirect.toString() } });
  }
});
