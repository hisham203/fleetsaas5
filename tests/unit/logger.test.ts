import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logLoginSuccess,
  logLoginFailure,
  logRateLimitHit,
  logSignupSuccess,
  logSignupFailure,
  logTenantSwitchSuccess,
  logTenantSwitchFailure,
  logHealthCheckFailure,
  logScriptEvent,
} from "@/lib/logger";

// Every test captures what actually got written to console.log/warn/error,
// parses it back as JSON, and asserts on the real emitted structure — not
// on the logger's internal implementation. This is deliberately how a log
// aggregator in production would consume these lines too (JSON.parse on
// stdout/stderr), so testing it this way is testing the real contract.

function captureConsole() {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return { logSpy, warnSpy, errorSpy };
}

function lastEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls[spy.mock.calls.length - 1];
  return JSON.parse(call[0] as string);
}

describe("logger — event emission", () => {
  let spies: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    spies = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logLoginSuccess emits an info-level JSON line with the expected shape", () => {
    logLoginSuccess({ path: "/api/auth/login", ip: "1.2.3.4", userId: "user-1", role: "ADMIN" });
    const entry = lastEntry(spies.logSpy);
    expect(entry.event).toBe("auth.login.success");
    expect(entry.level).toBe("info");
    expect(entry.path).toBe("/api/auth/login");
    expect(entry.ip).toBe("1.2.3.4");
    expect(entry.userId).toBe("user-1");
    expect(entry.role).toBe("ADMIN");
    expect(typeof entry.timestamp).toBe("string");
    expect(new Date(entry.timestamp as string).toString()).not.toBe("Invalid Date");
  });

  it("logLoginFailure emits a warn-level JSON line and never contains a password field", () => {
    logLoginFailure({ path: "/api/auth/login", ip: "1.2.3.4", reason: "invalid_credentials" });
    const entry = lastEntry(spies.warnSpy);
    expect(entry.event).toBe("auth.login.failure");
    expect(entry.level).toBe("warn");
    expect(entry.reason).toBe("invalid_credentials");
    expect(JSON.stringify(entry)).not.toMatch(/password/i);
  });

  it("logRateLimitHit emits a warn-level line with limit type and retry-after", () => {
    logRateLimitHit({ path: "/api/auth/login", ip: "5.5.5.5", limitType: "email", retryAfterSeconds: 900 });
    const entry = lastEntry(spies.warnSpy);
    expect(entry.event).toBe("rate_limit.hit");
    expect(entry.limitType).toBe("email");
    expect(entry.retryAfterSeconds).toBe(900);
  });

  it("logSignupSuccess and logSignupFailure emit at the correct levels", () => {
    logSignupSuccess({ path: "/api/auth/signup", ip: "1.1.1.1", tenantId: "tenant-1", userId: "user-1" });
    expect(lastEntry(spies.logSpy).event).toBe("auth.signup.success");

    logSignupFailure({ path: "/api/auth/signup", ip: "1.1.1.1", reason: "email_already_registered" });
    const failure = lastEntry(spies.warnSpy);
    expect(failure.event).toBe("auth.signup.failure");
    expect(failure.reason).toBe("email_already_registered");
  });

  it("logTenantSwitchSuccess includes both the home tenant and the effective (switched-to) tenant", () => {
    logTenantSwitchSuccess({
      path: "/api/platform/switch-tenant",
      userId: "platform-admin-1",
      tenantId: "home-tenant",
      effectiveTenantId: "granted-tenant",
    });
    const entry = lastEntry(spies.logSpy);
    expect(entry.tenantId).toBe("home-tenant");
    expect(entry.effectiveTenantId).toBe("granted-tenant");
  });

  it("logTenantSwitchFailure captures the specific denial reason", () => {
    logTenantSwitchFailure({
      path: "/api/platform/switch-tenant",
      userId: "ordinary-admin",
      attemptedTenantId: "some-other-tenant",
      reason: "not_authorized_for_tenant",
    });
    const entry = lastEntry(spies.warnSpy);
    expect(entry.reason).toBe("not_authorized_for_tenant");
    expect(entry.attemptedTenantId).toBe("some-other-tenant");
  });

  it("logHealthCheckFailure emits at error level", () => {
    logHealthCheckFailure({ message: "connect ECONNREFUSED 127.0.0.1:5432" });
    const entry = lastEntry(spies.errorSpy);
    expect(entry.event).toBe("health_check.failure");
    expect(entry.level).toBe("error");
  });

  it("logScriptEvent routes failure to error level and everything else to info", () => {
    logScriptEvent({ script: "backup", phase: "start" });
    expect(lastEntry(spies.logSpy).level).toBe("info");

    logScriptEvent({ script: "restore", phase: "failure", message: "pg_restore exited 1" });
    const failure = lastEntry(spies.errorSpy);
    expect(failure.level).toBe("error");
    expect(failure.event).toBe("script.restore.failure");
  });
});

describe("logger — sensitive-field redaction (defense in depth)", () => {
  let spies: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    spies = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // These typed functions don't have a `password`/`token` parameter in
  // their signatures at all — this test deliberately casts through `any`
  // to simulate a caller bypassing TypeScript (e.g. a future refactor that
  // loosens a type, or a raw JS caller), proving the redaction backstop in
  // emit() actually catches it rather than only relying on the type
  // system as the sole protection.
  it("redacts a field whose name contains 'password' even if a caller bypasses the types", () => {
    (logLoginFailure as (fields: Record<string, unknown>) => void)({
      path: "/api/auth/login",
      ip: "1.2.3.4",
      reason: "invalid_credentials",
      attemptedPassword: "hunter2",
    });
    const entry = lastEntry(spies.warnSpy);
    expect(entry.attemptedPassword).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("hunter2");
  });

  it("redacts token, cookie, authorization, and secret fields the same way", () => {
    (logTenantSwitchFailure as (fields: Record<string, unknown>) => void)({
      path: "/api/platform/switch-tenant",
      reason: "invalid_request",
      sessionToken: "abc123",
      cookieValue: "session_token=xyz",
      authorizationHeader: "Bearer abc",
      apiSecret: "sk_live_whatever",
    });
    const entry = lastEntry(spies.warnSpy);
    expect(entry.sessionToken).toBe("[REDACTED]");
    expect(entry.cookieValue).toBe("[REDACTED]");
    expect(entry.authorizationHeader).toBe("[REDACTED]");
    expect(entry.apiSecret).toBe("[REDACTED]");
    const raw = JSON.stringify(entry);
    expect(raw).not.toContain("abc123");
    expect(raw).not.toContain("xyz");
    expect(raw).not.toContain("Bearer abc");
    expect(raw).not.toContain("sk_live_whatever");
  });

  it("redacts a database connection string field", () => {
    (logScriptEvent as (fields: Record<string, unknown>) => void)({
      script: "backup",
      phase: "failure",
      databaseUrl: "postgresql://user:realpassword@host:5432/db",
    });
    const entry = lastEntry(spies.errorSpy);
    expect(entry.databaseUrl).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("realpassword");
  });

  it("does NOT redact ordinary safe fields that merely resemble sensitive ones in unrelated ways", () => {
    logLoginSuccess({ path: "/api/auth/login", ip: "1.2.3.4", userId: "user-1", role: "ADMIN" });
    const entry = lastEntry(spies.logSpy);
    // Sanity check that redaction is targeted, not overzealous — ordinary
    // fields must pass through untouched.
    expect(entry.userId).toBe("user-1");
    expect(entry.role).toBe("ADMIN");
    expect(entry.ip).toBe("1.2.3.4");
  });
});
