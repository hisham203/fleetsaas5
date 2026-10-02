/**
 * lib/deviceRateLimit.ts — Milestone H: Hardware device rate limiter.
 *
 * Keyed by IMEI/deviceIdentifier. Min gap: 5 seconds per device.
 * Prevents GPS storms from misconfigured or faulty hardware.
 *
 * Same single-instance limitation as lib/gpsRateLimit.ts — an in-memory
 * Map resets on restart. Acceptable for single-instance Railway deployment.
 * Documented, not an oversight.
 */

const store = new Map<string, number>(); // IMEI → last-accepted timestamp ms

const MIN_GAP_MS = 5_000; // 5 seconds — generous for typical 10–30s hardware cadence

// Periodic sweep — remove entries older than 10× the gap:
const sweep = setInterval(() => {
  const cutoff = Date.now() - MIN_GAP_MS * 10;
  for (const [k, ts] of store) if (ts < cutoff) store.delete(k);
}, 10 * 60_000);
sweep.unref?.();

let enabled = process.env.NODE_ENV !== "test";
export function __setDeviceRateLimitEnabled(value: boolean) { enabled = value; }
export function __resetDeviceRateLimit() { store.clear(); }

export type DeviceRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export function checkDeviceRateLimit(imei: string): DeviceRateLimitResult {
  if (!enabled) return { allowed: true };
  const now = Date.now();
  const last = store.get(imei) ?? 0;
  const gap = now - last;
  if (gap < MIN_GAP_MS) return { allowed: false, retryAfterMs: MIN_GAP_MS - gap };
  store.set(imei, now);
  return { allowed: true };
}
