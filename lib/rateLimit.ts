import { NextRequest } from "next/server";

// Basic in-memory rate limiting for auth-sensitive endpoints (login,
// signup) — a fixed-window counter per key, no external dependency.
//
// HONEST LIMITATION, read before deploying to more than one instance:
// this store is a plain in-memory Map, local to a single Node process.
// It resets on every restart/deploy, and — critically — if this app ever
// runs as more than one instance behind a load balancer (horizontal
// scaling), each instance has its OWN counters, so the real effective
// limit becomes (configured limit × instance count), not the configured
// limit. This is a deliberate, documented tradeoff for a small
// single-instance deployment (see DEPLOYMENT.md), not an oversight — a
// distributed store (Redis via a library like @upstash/ratelimit, or
// similar) is the correct fix once this app runs on more than one
// instance, and is NOT added here per the constraint against introducing
// infrastructure the project doesn't already have.
//
// Not a general-purpose rate limiter: this is intentionally small and
// scoped to auth-sensitive endpoints, not a piece of shared infrastructure
// for every route.

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

// Periodic sweep so memory doesn't grow unbounded with the number of
// distinct keys ever seen (distinct IPs/emails) over a long-running
// process. `.unref()` so this timer never keeps the Node process alive on
// its own — relevant for graceful shutdown and for tests.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

// Rate limiting is disabled by default under NODE_ENV=test — this codebase's
// test suite makes 60+ login calls across 20+ files via in-process route
// handler calls that carry no real client IP, so a naive IP-based limit
// would collide across unrelated tests and fail them for reasons that have
// nothing to do with what they're actually testing. The dedicated
// rate-limiting test file explicitly re-enables it for its own duration via
// __setEnabledForTests — see tests/integration/rate-limiting.test.ts.
let enabled = process.env.NODE_ENV !== "test";

export function __setEnabledForTests(value: boolean): void {
  enabled = value;
}

export function __resetForTests(): void {
  store.clear();
}

// Checks and — if allowed — consumes one unit against `key`'s window.
// Every call counts, whether the underlying request ultimately succeeds or
// fails (e.g. a successful login still consumes one unit) — the point is
// bounding the rate of requests to a sensitive endpoint, not just failures,
// which is both simpler and safer against a mixed success/failure
// credential-stuffing pattern.
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (!enabled) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
}

// Reads the real client IP behind a reverse proxy (see DEPLOYMENT.md — this
// app expects to sit behind nginx/Caddy/a cloud load balancer, never
// directly on the internet). Falls back to a shared "unknown" bucket when
// neither header is present (local dev with no proxy in front, or a
// misconfigured proxy in production — the latter is itself worth alerting
// on operationally, since it also affects the `secure` cookie logic).
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
