declare const Deno: {
  env: { get(key: string): string | undefined };
};

const API_KEY_PREFIX = "fc_kw-";
const API_KEY_PREFIXES = ["fc_kw-", "fc_sk-"]; // support legacy keys

export async function generateApiKey(): Promise<{
  fullKey: string;
  hash: string;
  prefix: string;
}> {
  const randomPart = generateRandomString(32);
  const fullKey = `${API_KEY_PREFIX}${randomPart}`;
  const prefix = fullKey.slice(0, 22);
  const hash = await sha256Hex(fullKey);
  return { fullKey, hash, prefix };
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function isApiKey(value: string): boolean {
  return API_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export async function verifyApiKey(
  key: string,
): Promise<{ userId: string; keyId: string } | null> {
  if (!isApiKey(key)) return null;

  const hash = await sha256Hex(key);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_api_keys?select=user_id%2Cid&key_hash=eq.${encodeURIComponent(hash)}&revoked_at=is.null`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) return null;

  const keys = (await res.json()) as Array<{ user_id: string; id: string }>;

  if (keys.length === 0) return null;

  // Update last_used_at (fire and forget)
  fetch(`${supabaseUrl}/rest/v1/user_api_keys?id=eq.${keys[0].id}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  return { userId: keys[0].user_id, keyId: keys[0].id };
}
