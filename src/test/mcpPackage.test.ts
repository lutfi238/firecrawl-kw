import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packageRoot = path.join(repoRoot, "packages", "firecrawl-kw-mcp");
const defaultEndpoint =
  "https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server";

describe("firecrawl-kw-mcp package", () => {
  it("defines an npx-compatible package with a binary", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );

    expect(pkg.name).toBe("firecrawl-kw-mcp");
    expect(pkg.version).toBe("0.1.1");
    expect(pkg.type).toBe("module");
    expect(pkg.license).toBe("MIT");
    expect(pkg.author).toBe("Muhammad Lutfi Firdaus");
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/lutfi238/firecrawl-kw.git",
      directory: "packages/firecrawl-kw-mcp",
    });
    expect(pkg.bin).toEqual({ "firecrawl-kw-mcp": "bin/firecrawl-kw-mcp.mjs" });
  });

  it("uses the centralized Supabase MCP endpoint by default", async () => {
    const proxy = await import("../../packages/firecrawl-kw-mcp/lib/proxy.mjs");

    expect(proxy.PROXY_VERSION).toBe("0.1.1");
    expect(proxy.DEFAULT_MCP_ENDPOINT).toBe(defaultEndpoint);
    expect(proxy.resolveEndpoint({}, proxy.DEFAULT_MCP_ENDPOINT)).toBe(
      defaultEndpoint,
    );
    expect(
      proxy.resolveEndpoint(
        { MCP_ENDPOINT: "https://custom.example/functions/v1/mcp-server" },
        proxy.DEFAULT_MCP_ENDPOINT,
      ),
    ).toBe("https://custom.example/functions/v1/mcp-server");
    expect(
      proxy.resolveEndpoint(
        { SUPABASE_URL: "https://project.supabase.co/" },
        "",
      ),
    ).toBe("https://project.supabase.co/functions/v1/mcp-server");
  });
});
