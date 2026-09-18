/**
 * GPS per-identity rate limiter — P2-01 Hotfix.
 *
 * Key is identity-aware: `tenantId:tripId:driverId`
 * This prevents three failure modes from the original tripId-only key:
 *   (1) unauthenticated callers consuming the driver's rate-limit window
 *   (2) cross-tenant requests interfering with legitimate pings
 *   (3) one authorized driver throttling another driver on the same trip
 *
 * IMPORTANT — single-instance limitation (same as lib/rateLimit.ts):
 * This store is a plain in-memory Map, local to one Node process.
 * It resets on every restart/deploy. If this app ever runs as more than
 * one instance behind a load balancer, each instance has its own counter
 * and the effective combined limit becomes (configured limit × instances).
 * A distributed store (Redis / Upstash / etc.) is required before horizontal
 * scaling. This is a documented, deliberate tradeoff for the P2-01 pilot
 * single-instance Railway deployment — NOT an oversight.
 *
 * Min gap: 4 seconds per identity-key. Allows normal 5–10s GPS cadence
 * with reasonable device/browser timing jitter.
 */

const store = new Map<string, number>(); // key → last-accepted timestamp (ms)

const MIN_GAP_MS = 4_000;

const SWEEP_MS = 10 * 60 * 1000; // sweep stale entries every 10 min
const sweep = setInterval(() => {
  const cutoff = Date.now() - MIN_GAP_MS * 10;
  for (const [k, ts] of store) if (ts < cutoff) store.delete(k);
}, SWEEP_MS);
sweep.unref?.();

let enabled = process.env.NODE_ENV !== "test";

export function __setGpsRateLimitEnabled(value: boolean): void { enabled = value; }
export function __resetGpsRateLimit(): void { store.clear(); }

export type GpsRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Call ONLY after full authentication and authorization has succeeded.
 * Unauthenticated / unauthorized requests must be rejected before reaching here
 * so they cannot consume the legitimate caller's rate-limit window.
 *
 * @param key  Composite identity key: `${tenantId}:${tripId}:${driverId}`
 */
export function checkGpsRateLimit(key: string): GpsRateLimitResult {
  if (!enabled) return { allowed: true };

  const now = Date.now();
  const last = store.get(key) ?? 0;
  const gap  = now - last;

  if (gap < MIN_GAP_MS) return { allowed: false, retryAfterMs: MIN_GAP_MS - gap };

  store.set(key, now);
  return { allowed: true };
}
