// OAuth 2.1 + Dynamic Client Registration for MCP Authorization spec.
// Lets Claude Web (and any MCP client that supports OAuth) connect with just the server URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const CODE_TTL_SEC = 5 * 60;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 90;

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

function base64url(buf: Uint8Array): string {
  let s = btoa(String.fromCharCode(...buf));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(hash));
}

export function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  // Edge Functions strip the function name from the path; reconstruct canonical mcp-server URL
  return `${url.origin}/functions/v1/mcp-server`;
}

// ---- Discovery ----

export function oauthProtectedResource(req: Request, corsHeaders: Record<string, string>): Response {
  const base = getBaseUrl(req);
  return json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  }, corsHeaders);
}

export function oauthAuthorizationServer(req: Request, corsHeaders: Record<string, string>): Response {
  const base = getBaseUrl(req);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    scopes_supported: ["mcp"],
  }, corsHeaders);
}

// ---- Dynamic Client Registration (RFC 7591) ----

export async function handleRegister(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_client_metadata" }, corsHeaders, 400); }

  const redirect_uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (redirect_uris.length === 0) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" }, corsHeaders, 400);
  }

  const client_id = `mcp_${randomToken(12)}`;
  const client_secret = randomToken(32);
  const client_secret_hash = await sha256(client_secret);
  const name = (body?.client_name as string) || "mcp-client";

  const sb = getServiceClient();
  const { error } = await sb.from("oauth_clients").insert({
    client_id, client_secret_hash, name, redirect_uris,
  });
  if (error) {
    console.error("[oauth] register failed", error);
    return json({ error: "server_error" }, corsHeaders, 500);
  }
  console.log("[oauth] register client_id=", client_id, "name=", name);

  return json({
    client_id,
    client_secret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris,
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, corsHeaders, 201);
}

// ---- Authorize ----

export async function handleAuthorizeGet(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;
  const client_id = params.get("client_id") || "";
  const redirect_uri = params.get("redirect_uri") || "";
  const state = params.get("state") || "";
  const code_challenge = params.get("code_challenge") || "";
  const code_challenge_method = params.get("code_challenge_method") || "plain";
  const scope = params.get("scope") || "mcp";

  // Validate client + redirect
  const sb = getServiceClient();
  const { data: client } = await sb.from("oauth_clients").select("client_id, redirect_uris").eq("client_id", client_id).maybeSingle();
  if (!client) {
    return new Response(htmlPage("Invalid client", `<p>Unknown <code>client_id</code>.</p>`), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    return new Response(htmlPage("Invalid redirect", `<p>The redirect_uri is not registered for this client.</p>`), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  const form = `
    <form method="POST" action="${getBaseUrl(req)}/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
      <input type="hidden" name="scope" value="${escapeHtml(scope)}">
      <label>Master Password</label>
      <input type="password" name="password" autofocus required>
      <button type="submit">Authorize</button>
    </form>
    <p class="meta">Client: <code>${escapeHtml(client_id)}</code></p>
  `;
  return new Response(htmlPage("Authorize MCP Connector", form), {
    headers: { ...corsHeaders, "Content-Type": "text/html" },
  });
}

export async function handleAuthorizePost(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const form = await req.formData();
  const client_id = String(form.get("client_id") || "");
  const redirect_uri = String(form.get("redirect_uri") || "");
  const state = String(form.get("state") || "");
  const code_challenge = String(form.get("code_challenge") || "");
  const code_challenge_method = String(form.get("code_challenge_method") || "plain");
  const scope = String(form.get("scope") || "mcp");
  const password = String(form.get("password") || "");

  const expected = Deno.env.get("MCP_MASTER_PASSWORD") || "";
  if (!expected || password !== expected) {
    console.warn("[oauth] authorize failed: bad password client_id=", client_id);
    return new Response(htmlPage("Denied", `<p>Wrong password.</p><p><a href="javascript:history.back()">Try again</a></p>`), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  const sb = getServiceClient();
  const { data: client } = await sb.from("oauth_clients").select("client_id, redirect_uris").eq("client_id", client_id).maybeSingle();
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    console.warn("[oauth] authorize failed: bad client/redirect");
    return new Response("Invalid client/redirect_uri", { status: 400, headers: corsHeaders });
  }

  const code = randomToken(32);
  const expires_at = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
  const { error } = await sb.from("oauth_codes").insert({
    code, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at,
  });
  if (error) {
    console.error("[oauth] code insert failed", error);
    return new Response("server error", { status: 500, headers: corsHeaders });
  }
  console.log("[oauth] authorize success client_id=", client_id);

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: redirect.toString() } });
}

// ---- Token endpoint ----

export async function handleToken(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const ct = req.headers.get("content-type") || "";
  let params: URLSearchParams;
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    const obj = await req.json();
    params = new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  } else {
    params = new URLSearchParams(await req.text());
  }

  // Client auth: support client_secret_post AND HTTP Basic
  let client_id = params.get("client_id") || "";
  let client_secret = params.get("client_secret") || "";
  const basic = req.headers.get("authorization");
  if (basic?.startsWith("Basic ")) {
    try {
      const decoded = atob(basic.slice(6));
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        client_id = client_id || decodeURIComponent(decoded.slice(0, idx));
        client_secret = client_secret || decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch { /* ignore */ }
  }

  const grant_type = params.get("grant_type") || "";
  const sb = getServiceClient();

  // Validate client (secret optional for public clients with PKCE — but DCR always issues a secret here)
  const { data: client } = await sb.from("oauth_clients").select("client_id, client_secret_hash").eq("client_id", client_id).maybeSingle();
  if (!client) {
    console.warn("[oauth] token invalid_client");
    return json({ error: "invalid_client" }, corsHeaders, 401);
  }
  if (client_secret) {
    const hash = await sha256(client_secret);
    if (hash !== client.client_secret_hash) {
      console.warn("[oauth] token invalid_client_secret");
      return json({ error: "invalid_client" }, corsHeaders, 401);
    }
  }

  if (grant_type === "authorization_code") {
    const code = params.get("code") || "";
    const redirect_uri = params.get("redirect_uri") || "";
    const code_verifier = params.get("code_verifier") || "";

    const { data: row } = await sb.from("oauth_codes").select("*").eq("code", code).maybeSingle();
    if (!row || row.used || row.client_id !== client_id || row.redirect_uri !== redirect_uri || new Date(row.expires_at) < new Date()) {
      console.warn("[oauth] invalid_grant code");
      return json({ error: "invalid_grant" }, corsHeaders, 400);
    }

    if (row.code_challenge) {
      const ok = await verifyPkce(code_verifier, row.code_challenge, row.code_challenge_method || "plain");
      if (!ok) {
        console.warn("[oauth] invalid_grant pkce");
        return json({ error: "invalid_grant", error_description: "PKCE mismatch" }, corsHeaders, 400);
      }
    }

    await sb.from("oauth_codes").update({ used: true }).eq("code", code);

    const issued = await issueToken(sb, client_id, row.scope || "mcp");
    console.log("[oauth] token issued client_id=", client_id);
    return json(issued, corsHeaders);
  }

  if (grant_type === "refresh_token") {
    const refresh_token = params.get("refresh_token") || "";
    const refresh_hash = await sha256(refresh_token);
    const { data: tok } = await sb.from("oauth_tokens").select("*").eq("refresh_token_hash", refresh_hash).maybeSingle();
    if (!tok || tok.revoked || tok.client_id !== client_id) {
      console.warn("[oauth] invalid_grant refresh");
      return json({ error: "invalid_grant" }, corsHeaders, 400);
    }
    await sb.from("oauth_tokens").update({ revoked: true }).eq("id", tok.id);
    const issued = await issueToken(sb, client_id, tok.scope || "mcp");
    console.log("[oauth] token refreshed client_id=", client_id);
    return json(issued, corsHeaders);
  }

  return json({ error: "unsupported_grant_type" }, corsHeaders, 400);
}

async function issueToken(sb: any, client_id: string, scope: string) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const access_hash = await sha256(access);
  const refresh_hash = await sha256(refresh);
  const expires_at = new Date(Date.now() + TOKEN_TTL_SEC * 1000).toISOString();
  await sb.from("oauth_tokens").insert({
    access_token_hash: access_hash,
    refresh_token_hash: refresh_hash,
    client_id, scope, expires_at,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SEC,
    refresh_token: refresh,
    scope,
  };
}

async function verifyPkce(verifier: string, challenge: string, method: string): Promise<boolean> {
  if (!verifier) return false;
  if (method === "plain") return verifier === challenge;
  if (method === "S256") {
    const h = await sha256(verifier);
    return h === challenge;
  }
  return false;
}

// ---- Bearer validation (called from MCP request handler) ----

export async function validateBearer(token: string): Promise<{ ok: boolean; client_id?: string }> {
  if (!token) return { ok: false };
  const sb = getServiceClient();
  const hash = await sha256(token);
  const { data } = await sb.from("oauth_tokens").select("client_id, expires_at, revoked").eq("access_token_hash", hash).maybeSingle();
  if (!data || data.revoked) return { ok: false };
  if (new Date(data.expires_at) < new Date()) return { ok: false };
  return { ok: true, client_id: data.client_id };
}

// ---- helpers ----

function json(body: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function htmlPage(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-monospace, Menlo, monospace; background: #080D1A; color: #e6f1ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: rgba(20,30,55,.75); border: 1px solid #1f2a4a; padding: 32px; border-radius: 12px; max-width: 420px; width: 100%; box-shadow: 0 0 40px rgba(0,200,255,.15); }
  h1 { font-size: 18px; margin: 0 0 16px; letter-spacing: 2px; color: #4fd6ff; text-transform: uppercase; }
  form { display: flex; flex-direction: column; gap: 12px; }
  label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #8aa1c1; }
  input { background: #0b1428; color: #e6f1ff; border: 1px solid #1f2a4a; padding: 10px 12px; border-radius: 6px; font: inherit; }
  input:focus { outline: none; border-color: #4fd6ff; }
  button { background: linear-gradient(135deg, #4fd6ff, #a874ff); color: #050913; border: 0; padding: 12px; border-radius: 6px; font-weight: 700; cursor: pointer; letter-spacing: 1px; }
  .meta { color: #5d7396; font-size: 11px; margin-top: 16px; word-break: break-all; }
  code { color: #4fd6ff; }
  a { color: #4fd6ff; }
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1>${inner}</div></body></html>`;
}
