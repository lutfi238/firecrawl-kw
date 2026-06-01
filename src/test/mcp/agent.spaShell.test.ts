import { describe, expect, it } from "vitest";

import { isThinSpaShell } from "../../../supabase/functions/mcp-server/tools/agent/content";

describe("isThinSpaShell", () => {
  it("detects empty SPA roots on docs URLs", () => {
    expect(isThinSpaShell('<html><body><div id="root"></div></body></html>', "https://platform.openai.com/docs/models")).toBe(true);
  });

  it("detects nav-heavy OpenAI docs static HTML", () => {
    const navLinks = Array.from({ length: 80 }, (_, i) => `<a href="/docs/${i}">Navigation ${i}</a>`).join("");
    const html = `<html><body><nav>${navLinks}</nav><aside>${navLinks}</aside><main><p>Short breadcrumb shell.</p></main></body></html>`;
    expect(isThinSpaShell(html, "https://platform.openai.com/docs/models")).toBe(true);
  });

  it("does not mark rich docs pages as thin", () => {
    const html = `<main>${"Model documentation content ".repeat(50)}</main>`;
    expect(isThinSpaShell(html, "https://docs.anthropic.com/en/docs/about-claude/models/overview")).toBe(false);
  });
});
