import { createInterface } from "node:readline";
import process from "node:process";

export const DEFAULT_MCP_ENDPOINT =
  "https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server";

const PROXY_NAME = "firecrawl-kw-mcp";
const PROXY_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

export function resolveEndpoint(values, defaultEndpoint = DEFAULT_MCP_ENDPOINT) {
  if (values.MCP_ENDPOINT) return values.MCP_ENDPOINT;

  const supabaseUrl = values.SUPABASE_URL || values.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp-server`;
  }

  return defaultEndpoint;
}

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function isNotification(message) {
  return message.id === undefined || message.id === null;
}

function getClientProtocolVersion(params) {
  if (!params || typeof params !== "object") return DEFAULT_PROTOCOL_VERSION;
  const value = params.protocolVersion;
  return typeof value === "string" && value.length > 0
    ? value
    : DEFAULT_PROTOCOL_VERSION;
}

function parseServerSentEventResponse(text, fallbackId) {
  const lines = text.split(/\r?\n/);
  let lastJson = null;

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trimStart();
    if (!payload || payload === "[DONE]") continue;

    try {
      const parsed = JSON.parse(payload);

      if (parsed.jsonrpc === "2.0") {
        lastJson = parsed;
        continue;
      }

      if (parsed.error) {
        lastJson = makeError(fallbackId, -32603, String(parsed.error));
        continue;
      }

      if (typeof parsed.delta === "string") {
        const previousText = extractTextFromToolResult(lastJson);
        lastJson = makeResponse(fallbackId, {
          content: [{ type: "text", text: `${previousText}${parsed.delta}` }],
        });
      }
    } catch {
      // Ignore non-JSON SSE data lines.
    }
  }

  return lastJson;
}

function extractTextFromToolResult(response) {
  const content = response?.result?.content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .join("\n");
}

function writeJson(stdout, message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function createDebug(stderr, enabled) {
  return (message, metadata) => {
    if (!enabled) return;
    if (metadata === undefined) {
      stderr.write(`[${PROXY_NAME}] ${message}\n`);
      return;
    }
    stderr.write(`[${PROXY_NAME}] ${message} ${JSON.stringify(metadata)}\n`);
  };
}

export function createProxyRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
  defaultEndpoint = DEFAULT_MCP_ENDPOINT,
} = {}) {
  const endpoint = resolveEndpoint(env, defaultEndpoint);
  const requestTimeoutMs = parsePositiveInteger(
    env.MCP_REQUEST_TIMEOUT_MS,
    120_000,
  );
  const debugEnabled =
    env.MCP_STDIO_DEBUG === "1" || env.MCP_STDIO_DEBUG === "true";
  const mcpSecret = env.MCP_SECRET || env.X_MCP_SECRET || "";
  const githubToken = env.GITHUB_TOKEN || env.X_GITHUB_TOKEN || "";
  const authToken =
    env.SUPABASE_ACCESS_TOKEN || env.AUTHORIZATION_BEARER_TOKEN || "";
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const debug = createDebug(stderr, debugEnabled);

  if (!fetchImpl) {
    throw new Error("firecrawl-kw-mcp requires Node.js 18+ with global fetch");
  }

  async function forwardToHttpMcp(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    if (apiKey) headers.apikey = apiKey;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (githubToken) headers["X-GitHub-Token"] = githubToken;
    if (mcpSecret) headers["X-MCP-Secret"] = mcpSecret;

    try {
      debug("Forwarding request", { method: message.method, id: message.id });

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (!response.ok) {
        return makeError(
          message.id,
          -32000,
          `Remote MCP endpoint returned HTTP ${response.status}`,
          text.slice(0, 2_000),
        );
      }

      if (contentType.includes("text/event-stream")) {
        return (
          parseServerSentEventResponse(text, message.id) ??
          makeError(
            message.id,
            -32603,
            "Remote MCP endpoint returned an empty SSE response",
          )
        );
      }

      if (!text.trim()) {
        return makeError(
          message.id,
          -32603,
          "Remote MCP endpoint returned an empty response",
        );
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        return makeError(
          message.id,
          -32700,
          "Remote MCP endpoint returned invalid JSON",
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return makeError(
        message.id,
        aborted ? -32001 : -32603,
        aborted
          ? `Remote MCP request timed out after ${requestTimeoutMs}ms`
          : "Failed to reach remote MCP endpoint",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  function handleLocalRequest(message) {
    if (message.method === "initialize") {
      const protocolVersion = getClientProtocolVersion(message.params);

      return makeResponse(message.id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: PROXY_NAME,
          version: PROXY_VERSION,
        },
      });
    }

    return null;
  }

  async function handleMessage(message) {
    if (!message || typeof message !== "object") {
      writeJson(stdout, makeError(null, -32600, "Invalid Request"));
      return;
    }

    if (message.jsonrpc !== "2.0") {
      writeJson(stdout, makeError(message.id, -32600, "Invalid JSON-RPC version"));
      return;
    }

    if (typeof message.method !== "string") {
      if (!isNotification(message)) {
        writeJson(
          stdout,
          makeError(message.id, -32600, "Invalid Request: method must be a string"),
        );
      }
      return;
    }

    if (isNotification(message)) {
      debug("Received notification", { method: message.method });
      return;
    }

    const local = handleLocalRequest(message);
    if (local) {
      writeJson(stdout, local);
      return;
    }

    const response = await forwardToHttpMcp(message);
    writeJson(stdout, response);
  }

  return {
    endpoint,
    handleMessage,
  };
}

export function runStdioProxy(options = {}) {
  const runtime = createProxyRuntime(options);

  const input = options.input ?? process.stdin;
  const stderr = options.stderr ?? process.stderr;

  const rl = createInterface({ input, crlfDelay: Infinity });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      const stdout = options.stdout ?? process.stdout;
      writeJson(stdout, makeError(null, -32700, "Parse error"));
      return;
    }

    runtime.handleMessage(message).catch((error) => {
      stderr.write(
        `[${PROXY_NAME}] Unhandled request error ${
          error instanceof Error ? error.stack || error.message : String(error)
        }\n`,
      );
    });
  });

  rl.on("close", () => process.exit(0));

  return runtime;
}
