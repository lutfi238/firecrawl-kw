import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("application route loading", () => {
  it("loads every route page through React.lazy", () => {
    const routePages = [
      "Overview",
      "ToolTester",
      "RequestMonitor",
      "Settings",
      "AIChat",
      "DeploymentGuide",
      "McpAuthorize",
      "APITester",
      "ApiKeysPage",
      "NotFound",
    ];

    for (const page of routePages) {
      expect(appSource).toContain(
        `const ${page} = lazy(() => import("@/pages/${page}"));`,
      );
      expect(appSource).not.toMatch(
        new RegExp(`import\\s+${page}\\s+from\\s+["']@/pages/${page}["']`),
      );
    }

    expect(appSource).toContain("<Suspense fallback={<RouteFallback />}");
  });
});
