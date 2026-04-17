import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildRefererCandidates,
  rememberRefererFailure,
  rememberSuccessfulReferer,
  resetRefererMemory,
} from "../src/routes/proxy.ts";

describe("proxy referer memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T00:00:00.000Z"));
    resetRefererMemory();
  });

  afterEach(() => {
    resetRefererMemory();
    vi.useRealTimers();
  });

  test("prioritizes the last successful referer for the same host", () => {
    rememberSuccessfulReferer("fxpy7.watching.onl", "https://rabbitstream.net/");

    const candidates = buildRefererCandidates(
      "fxpy7.watching.onl",
      "https://megacloud.club/",
      "https://megacloud.club/",
      "https://fxpy7.watching.onl"
    );

    expect(candidates[0]).toBe("https://rabbitstream.net/");
    expect(candidates).toContain("https://megacloud.club/");
  });

  test("moves recently failed referers behind clean candidates", () => {
    rememberRefererFailure("fxpy7.watching.onl", "https://megacloud.club/", 403);

    const candidates = buildRefererCandidates(
      "fxpy7.watching.onl",
      "https://megacloud.club/",
      "https://megacloud.club/",
      "https://fxpy7.watching.onl"
    );

    expect(candidates[0]).toBe("https://fxpy7.watching.onl/");
    expect(candidates.indexOf("https://megacloud.club/")).toBeGreaterThan(
      candidates.indexOf("https://fxpy7.watching.onl/")
    );
  });
});
