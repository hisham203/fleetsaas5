import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { checkRateLimit, getClientIp, __setEnabledForTests, __resetForTests } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

describe("checkRateLimit (pure algorithm)", () => {
  beforeEach(() => {
    __setEnabledForTests(true);
    __resetForTests();
  });

  afterAll(() => {
    __setEnabledForTests(false); // restore the default test-mode behavior for every other file
  });

  it("allows requests up to the limit, then blocks", () => {
    const key = "test:key:1";
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
    }
    const sixth = checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks distinct keys independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("test:key:a", 5, 60_000);
    const blockedA = checkRateLimit("test:key:a", 5, 60_000);
    const allowedB = checkRateLimit("test:key:b", 5, 60_000);
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("resets the window after it elapses", async () => {
    const key = "test:key:short-window";
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 50); // 50ms window
    expect(checkRateLimit(key, 3, 50).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 80));
    expect(checkRateLimit(key, 3, 50).allowed).toBe(true);
  });

  it("reports decreasing remaining count as the window fills", () => {
    const key = "test:key:remaining";
    const first = checkRateLimit(key, 3, 60_000);
    const second = checkRateLimit(key, 3, 60_000);
    expect(first.remaining).toBe(2);
    expect(second.remaining).toBe(1);
  });

  it("is a no-op (always allows) when disabled", () => {
    __setEnabledForTests(false);
    const key = "test:key:disabled";
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
  });
});

describe("getClientIp", () => {
  it("prefers the first address in x-forwarded-for", () => {
    const req = new NextRequest(new Request("http://localhost/test", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    }));
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new NextRequest(new Request("http://localhost/test", {
      headers: { "x-real-ip": "9.9.9.9" },
    }));
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to a shared 'unknown' bucket when neither header is present", () => {
    const req = new NextRequest(new Request("http://localhost/test"));
    expect(getClientIp(req)).toBe("unknown");
  });
});
