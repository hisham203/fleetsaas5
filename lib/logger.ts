// Minimal structured logging — console-based JSON lines, no logging
// platform dependency. In production, stdout/stderr from a Node process
// is exactly what every major hosting platform (Railway, Render, ECS,
// Kubernetes) already captures and forwards to its own log
// viewer/aggregator — writing structured JSON to console is the
// zero-infrastructure way to make that captured output actually
// searchable/filterable there, without this app needing to know anything
// about where its logs end up.
//
// SAFETY DESIGN: the primary safety rail is that callers use the specific,
// narrowly-typed logXxx functions below — each one's TypeScript signature
// only accepts the exact safe fields that event needs, so there is no
// generic "pass any object" path for the six event categories this file
// covers. A denylist-based redaction in emit() is a defense-in-depth
// backstop underneath that, not the primary protection — it exists in
// case a field name that looks safe (e.g. a future "authToken") slips
// into a fields object despite the typed signatures, not as the only
// thing standing between this code and leaking a credential.
//
// Never logged, by construction of every function below: raw passwords,
// password hashes, session tokens, cookie values, Authorization headers,
// DATABASE_URL/connection strings, or full request/response bodies.

export type LogLevel = "info" | "warn" | "error";

// Checked at emit time regardless of which typed function was used —
// belt-and-suspenders, not the main protection (see file header).
const FORBIDDEN_KEY_FRAGMENTS = [
  "password",
  "passwordhash",
  "token",
  "cookie",
  "authorization",
  "secret",
  "databaseurl",
  "database_url",
  "connectionstring",
  "connection_string",
];

function redactForbidden(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    safe[key] = FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) ? "[REDACTED]" : value;
  }
  return safe;
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redactForbidden(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ---------- Auth: login ----------
// Deliberately no `password` or `token` parameter exists anywhere in
// these signatures — there is nothing to accidentally forget to omit.
export function logLoginSuccess(fields: { path: string; ip: string; userId: string; role: string }): void {
  emit("info", "auth.login.success", fields);
}

export function logLoginFailure(fields: {
  path: string;
  ip: string;
  reason: "invalid_credentials" | "rate_limited_ip" | "rate_limited_email";
}): void {
  emit("warn", "auth.login.failure", fields);
}

// ---------- Rate limiting ----------
export function logRateLimitHit(fields: {
  path: string;
  ip: string;
  limitType: "ip" | "email";
  retryAfterSeconds: number;
}): void {
  emit("warn", "rate_limit.hit", fields);
}

// ---------- Auth: signup ----------
export function logSignupSuccess(fields: { path: string; ip: string; tenantId: string; userId: string }): void {
  emit("info", "auth.signup.success", fields);
}

export function logSignupFailure(fields: {
  path: string;
  ip: string;
  reason: "validation_error" | "email_already_registered" | "rate_limited";
}): void {
  emit("warn", "auth.signup.failure", fields);
}

// ---------- Company Switcher ----------
export function logTenantSwitchSuccess(fields: {
  path: string;
  userId: string;
  tenantId: string;
  effectiveTenantId: string;
}): void {
  emit("info", "tenant_switch.success", fields);
}

export function logTenantSwitchFailure(fields: {
  path: string;
  userId?: string;
  attemptedTenantId?: string;
  reason: "not_authenticated" | "not_platform_admin" | "not_authorized_for_tenant" | "tenant_not_found" | "invalid_request";
}): void {
  emit("warn", "tenant_switch.failure", fields);
}

// ---------- Health check ----------
// Only failure is logged — a health check is typically polled every few
// seconds by a load balancer, so logging every success would be pure
// noise for no diagnostic benefit.
export function logHealthCheckFailure(fields: { message: string }): void {
  emit("error", "health_check.failure", fields);
}

// ---------- Maintenance scripts (backup/restore/seed) ----------
// Used by CLI scripts in addition to (not instead of) their existing
// human-readable console output — a person running the script directly
// still gets readable progress messages; this adds a structured event
// line for anyone piping script output into the same log aggregation as
// the app's own logs.
export function logScriptEvent(fields: {
  script: "backup" | "restore" | "seed";
  phase: "start" | "success" | "failure";
  message?: string;
}): void {
  emit(fields.phase === "failure" ? "error" : "info", `script.${fields.script}.${fields.phase}`, fields);
}
