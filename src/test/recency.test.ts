import { describe, expect, it } from "vitest";
import { buildRuntimeDateHints, detectRecencyProfile } from "@/lib/recency";
import { needsEvidence } from "@/lib/intentClassifier";

describe("detectRecencyProfile", () => {
  it("detects strict recent intent for latest news queries", () => {
    const profile = detectRecencyProfile("latest technology news");

    expect(profile.mode).toBe("recent");
    expect(profile.strictFreshness).toBe(true);
    expect(profile.preferNewsSources).toBe(true);
    expect(profile.window).toBe("recent");
  });

  it("detects current-window intent for this week queries", () => {
    const profile = detectRecencyProfile("apa update AI minggu ini?");

    expect(profile.mode).toBe("current_window");
    expect(profile.window).toBe("week");
    expect(profile.strictFreshness).toBe(true);
  });

  it("detects future intent for upcoming queries", () => {
    const profile = detectRecencyProfile("fitur AI yang akan datang tahun depan");

    expect(profile.mode).toBe("future");
    expect(profile.preferNewsSources).toBe(true);
  });

  it("does not force recency for evergreen ranking queries", () => {
    const profile = detectRecencyProfile("best AI tools for coding");

    expect(profile.mode).toBe("none");
    expect(profile.strictFreshness).toBe(false);
  });
});

describe("buildRuntimeDateHints", () => {
  it("builds dynamic month and year hints from runtime date", () => {
    const hints = buildRuntimeDateHints(new Date("2026-04-21T10:00:00.000Z"));

    expect(hints.currentYear).toBe("2026");
    expect(hints.currentMonthLabel).toBe("April 2026");
    expect(hints.nextYear).toBe("2027");
  });
});

describe("needsEvidence", () => {
  it("treats recency-sensitive prompts as evidence-seeking without hardcoded years", () => {
    expect(needsEvidence("what changed this week in AI")).toBe(true);
  });

  it("keeps casual chat out of evidence routing", () => {
    expect(needsEvidence("hello there")).toBe(false);
  });
});