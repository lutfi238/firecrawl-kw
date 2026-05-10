#!/usr/bin/env node

/**
 * Local MCP stdio bridge for Personal Firecrawl MCP.
 *
 * MCP clients such as Claude Desktop/Cline/Cursor can launch this script with
 * a `command` / `args` / `env` config. The script speaks newline-delimited
 * JSON-RPC over stdin/stdout and forwards MCP requests to the deployed
 * Supabase Edge Function MCP endpoint.
 *
 * Keep stdout reserved for MCP JSON-RPC messages only. Logs go to stderr.
 */

import { createInterface } from "node:readline";
import process from "node:process";

const PROXY_NAME = "personal-firecrawl-stdio-proxy";
const PROXY_VERSION = "1.0.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

const env = process.env;
const endpoint = resolveEndpoint(env);
const requestTimeoutMs = parsePositiveInteger(env.MCP_REQUEST_TIMEOUT_MS, 120_000);
const debugEnabled = env.MCP_STDIO_DEBUG === "1" || env.MCP_STDIO_DEBUG === "true";
const mcpSecret = env.MCP_SECRET || env.X_MCP_SECRET || "";
const githubToken = env.GITHUB_TOKEN || env.X_GITHUB_TOKEN || "";
const authToken = env.SUPABASE_ACCESS_TOKEN || env.AUTHORIZATION_BEARER_TOKEN || "";
const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

if (!endpoint) {
  console.error(
    `[${PROXY_NAME}] Missing MCP endpoint. Set MCP_ENDPOINT, or set SUPABASE_URL/VITE_SUPABASE_URL so the proxy can use <url>/functions/v1/mcp-server.`,
  );
  process.exit(1);
}

function resolveEndpoint(values) {
  if (values.MCP_ENDPOINT) return values.MCP_ENDPOINT;

  const supabaseUrl = values.SUPABASE_URL || values.VITE_SUPABASE_URL;
  if (!supabaseUrl) return "";

  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp-server`;
}

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function debug(message, metadata) {
  if (!debugEnabled) return;
  if (metadata === undefined) {
    console.error(`[${PROXY_NAME}] ${message}`);
    return;
  }
  console.error(`[${PROXY_NAME}] ${message}`, metadata);
}

function writeJson(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_PROTOCOL_VERSION;
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

    const response = await fetch(endpoint, {
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
      const streamed = parseServerSentEventResponse(text, message.id);
      return streamed ?? makeError(message.id, -32603, "Remote MCP endpoint returned an empty SSE response");
    }

    if (!text.trim()) {
      return makeError(message.id, -32603, "Remote MCP endpoint returned an empty response");
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
      aborted ? `Remote MCP request timed out after ${requestTimeoutMs}ms` : "Failed to reach remote MCP endpoint",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }
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
    writeJson(makeError(null, -32600, "Invalid Request"));
    return;
  }

  if (message.jsonrpc !== "2.0") {
    writeJson(makeError(message.id, -32600, "Invalid JSON-RPC version"));
    return;
  }

  if (typeof message.method !== "string") {
    if (!isNotification(message)) {
      writeJson(makeError(message.id, -32600, "Invalid Request: method must be a string"));
    }
    return;
  }

  if (isNotification(message)) {
    debug("Received notification", { method: message.method });
    return;
  }

  const localResponse = handleLocalRequest(message);
  if (localResponse) {
    writeJson(localResponse);
    return;
  }

  const response = await forwardToHttpMcp(message);
  writeJson(response);
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

let queue = Promise.resolve();

input.on("line", (line) => {
  const payload = line.trim();
  if (!payload) return;

  queue = queue
    .then(async () => {
      let message;
      try {
        message = JSON.parse(payload);
      } catch (error) {
        writeJson(makeError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
        return;
      }

      await handleMessage(message);
    })
    .catch((error) => {
      writeJson(makeError(null, -32603, "Internal proxy error", error instanceof Error ? error.message : String(error)));
    });
});

input.on("close", () => {
  debug("stdin closed");
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

debug("ready", { endpoint, requestTimeoutMs });
