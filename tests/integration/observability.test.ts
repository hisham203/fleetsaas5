import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// Verifies logging actually fires from the real route handlers with real
// session/tenant data — not just that the logger functions work in
// isolation (tests/unit/logger.test.ts already covers that). Spies on
// console methods for the duration of each test only.
describe("observability: logging fires from real routes", () => {
  function captureConsole() {
    return {
      logSpy: vi.spyOn(console, "log").mockImplementation(() => {}),
      warnSpy: vi.spyOn(console, "warn").mockImplementation(() => {}),
      errorSpy: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  }

  function entriesFrom(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
    return spy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[0] as string);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  let spies: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    spies = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a real successful login produces an auth.login.success line with no password anywhere in it", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    await POST(makeRequest("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: { email: "admin@demo-water.co", password: "password123" },
    }));

    const entries = entriesFrom(spies.logSpy);
    const successEntry = entries.find((e) => e.event === "auth.login.success");
    expect(successEntry).toBeTruthy();
    expect(successEntry!.ip).toBe("203.0.113.10");
    expect(successEntry!.role).toBe("ADMIN");
    expect(JSON.stringify(successEntry)).not.toContain("password123");
  });

  it("a real failed login produces an auth.login.failure line, still with no password in it", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    await POST(makeRequest("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.11" },
      body: { email: "admin@demo-water.co", password: "definitely-wrong" },
    }));

    const entries = entriesFrom(spies.warnSpy);
    const failureEntry = entries.find((e) => e.event === "auth.login.failure");
    expect(failureEntry).toBeTruthy();
    expect(failureEntry!.reason).toBe("invalid_credentials");
    expect(JSON.stringify(failureEntry)).not.toContain("definitely-wrong");
  });

  it("a real Company Switcher success logs both the home tenant and the switched-to tenant", async () => {
    const platformAdminCookie = await loginAs("platform-admin@fleetops-demo.co", "password123");
    spies = captureConsole(); // reset after the setup login above added its own entries

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
    const acmeTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: acmeCookie }))).json()).id;

    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    await switchTenant(makeRequest("/api/platform/switch-tenant", {
      method: "POST",
      cookie: platformAdminCookie,
      body: { tenantId: acmeTenantId },
    }));

    const entries = entriesFrom(spies.logSpy);
    const successEntry = entries.find((e) => e.event === "tenant_switch.success");
    expect(successEntry).toBeTruthy();
    expect(successEntry!.effectiveTenantId).toBe(acmeTenantId);
    expect(successEntry!.tenantId).not.toBe(acmeTenantId); // home tenant, distinct from the switched-to one
  });

  it("an unauthorized Company Switcher attempt logs the specific denial reason, not just a generic failure", async () => {
    const ordinaryAdminCookie = await loginAs("admin@demo-water.co", "password123");
    spies = captureConsole();

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
    const acmeTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: acmeCookie }))).json()).id;
    spies = captureConsole();

    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    await switchTenant(makeRequest("/api/platform/switch-tenant", {
      method: "POST",
      cookie: ordinaryAdminCookie,
      body: { tenantId: acmeTenantId },
    }));

    const entries = entriesFrom(spies.warnSpy);
    const failureEntry = entries.find((e) => e.event === "tenant_switch.failure");
    expect(failureEntry).toBeTruthy();
    expect(failureEntry!.reason).toBe("not_platform_admin");
  });

  it("a real rate-limit hit on login produces both a rate_limit.hit and an auth.login.failure line", async () => {
    const { __setEnabledForTests, __resetForTests } = await import("@/lib/rateLimit");
    __setEnabledForTests(true);
    __resetForTests();

    const { POST } = await import("@/app/api/auth/login/route");
    const ip = "203.0.113.20";
    for (let i = 0; i < 10; i++) {
      await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: `nobody-${i}@demo-water.co`, password: "wrong" },
      }));
    }
    spies = captureConsole();
    await POST(makeRequest("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: { email: "one-more@demo-water.co", password: "wrong" },
    }));

    __setEnabledForTests(false); // restore default test-mode behavior for every other file

    const rateLimitEntries = entriesFrom(spies.warnSpy);
    const hitEntry = rateLimitEntries.find((e) => e.event === "rate_limit.hit");
    expect(hitEntry).toBeTruthy();
    expect(hitEntry!.limitType).toBe("ip");
    const failureEntry = rateLimitEntries.find((e) => e.event === "auth.login.failure" && e.reason === "rate_limited_ip");
    expect(failureEntry).toBeTruthy();
  });

  it("a health check failure is logged at error level with a safe, non-credential message", async () => {
    const dbClient = await import("@/lib/db/client");
    const originalQuery = dbClient.pool.query.bind(dbClient.pool);
    vi.spyOn(dbClient.pool, "query").mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);

    const entries = entriesFrom(spies.errorSpy);
    const failureEntry = entries.find((e) => e.event === "health_check.failure");
    expect(failureEntry).toBeTruthy();
    expect(failureEntry!.message).toContain("ECONNREFUSED");

    dbClient.pool.query = originalQuery;
  });
});
