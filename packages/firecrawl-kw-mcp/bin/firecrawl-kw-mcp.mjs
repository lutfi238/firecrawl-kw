#!/usr/bin/env node

import { runStdioProxy } from "../lib/proxy.mjs";

try {
  runStdioProxy();
} catch (error) {
  console.error(
    `[firecrawl-kw-mcp] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
