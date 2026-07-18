import { expect, test } from "../playwright-fixture";

test("frontend reaches a valid unauthenticated entry state", async ({ page }) => {
  await page.goto("/");

  const configurationGate = page.getByRole("heading", {
    name: "HOSTED BACKEND NOT CONFIGURED",
  });
  const signIn = page.getByRole("heading", { name: "FIRECRAWL MCP" });

  await expect(configurationGate.or(signIn)).toBeVisible();
});

test("hosted MCP health endpoint is reachable", async ({ request }) => {
  const response = await request.get(
    "https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server",
  );
  expect(response.ok()).toBe(true);

  const health = (await response.json()) as {
    status?: string;
    tools?: number;
    oauth?: boolean;
  };
  expect(health.status).toBe("ok");
  expect(health.oauth).toBe(true);
  expect(health.tools).toBeGreaterThanOrEqual(20);
});
