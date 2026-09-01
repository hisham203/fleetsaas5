import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { makeRequest } from "../helpers/request";
import { __setEnabledForTests, __resetForTests } from "@/lib/rateLimit";

// Rate limiting is disabled by default under NODE_ENV=test (see
// lib/rateLimit.ts — the rest of this suite makes 60+ login calls across
// 20+ files with no real client IP, which would otherwise collide on one
// shared bucket). This file explicitly re-enables it for its own duration
// and uses a unique x-forwarded-for per test to avoid interfering with
// anything else, restoring the default afterward.
describe("rate limiting on auth endpoints", () => {
  beforeAll(() => {
    __setEnabledForTests(true);
  });

  afterAll(() => {
    __setEnabledForTests(false);
  });

  beforeEach(() => {
    __resetForTests();
  });

  describe("POST /api/auth/login", () => {
    it("a normal login still works before any limit is hit", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      const res = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.1" },
        body: { email: "admin@demo-water.co", password: "password123" },
      }));
      expect(res.status).toBe(200);
    });

    it("returns 429 with Retry-After after exceeding the per-IP limit", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      const ip = "10.0.0.2";

      // The configured IP limit is 10/15min — fire 10 (failed, wrong
      // password, deliberately — see the next test for why failures count
      // the same as successes) to exhaust it, then confirm the 11th is
      // blocked.
      for (let i = 0; i < 10; i++) {
        const res = await POST(makeRequest("/api/auth/login", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { email: `nobody-${i}@demo-water.co`, password: "wrong" },
        }));
        expect(res.status).toBe(401); // each individual attempt still resolves normally
      }

      const blocked = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: "one-more@demo-water.co", password: "wrong" },
      }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBeTruthy();
      const body = await blocked.json();
      expect(body.error).toMatch(/too many/i);
    });

    it("failed login attempts count toward the limit, not just successes", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      const ip = "10.0.0.3";

      // 5 failed attempts against the SAME email exhausts the per-email
      // limit (5/15min) even though the IP limit (10/15min) isn't hit yet.
      for (let i = 0; i < 5; i++) {
        await POST(makeRequest("/api/auth/login", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { email: "targeted@demo-water.co", password: "wrong" },
        }));
      }
      const blocked = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: "targeted@demo-water.co", password: "wrong" },
      }));
      expect(blocked.status).toBe(429);
    });

    it("the per-email limit doesn't block a different email from the same IP", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      const ip = "10.0.0.4";

      for (let i = 0; i < 5; i++) {
        await POST(makeRequest("/api/auth/login", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { email: "victim-a@demo-water.co", password: "wrong" },
        }));
      }
      // victim-a is now rate-limited by email, but a login attempt for a
      // completely different email from the same IP should still go
      // through the (not-yet-exhausted) IP bucket normally.
      const res = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: "victim-b@demo-water.co", password: "wrong" },
      }));
      expect(res.status).toBe(401); // wrong password, but NOT 429
    });

    it("a successful login consumes one unit of the same limit as failures do", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      const ip = "10.0.0.5";

      // 9 failures, then the 10th (successful) attempt should still work —
      // exactly at the limit, not yet over it.
      for (let i = 0; i < 9; i++) {
        await POST(makeRequest("/api/auth/login", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { email: `filler-${i}@demo-water.co`, password: "wrong" },
        }));
      }
      const success = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: "admin@demo-water.co", password: "password123" },
      }));
      expect(success.status).toBe(200);

      // The 11th attempt (1 over the limit of 10) should now be blocked,
      // proving the successful one above genuinely counted.
      const blocked = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { email: "admin@demo-water.co", password: "password123" },
      }));
      expect(blocked.status).toBe(429);
    });

    it("distinct IPs are tracked independently", async () => {
      const { POST } = await import("@/app/api/auth/login/route");
      for (let i = 0; i < 10; i++) {
        await POST(makeRequest("/api/auth/login", {
          method: "POST",
          headers: { "x-forwarded-for": "10.0.0.6" },
          body: { email: `spam-${i}@demo-water.co`, password: "wrong" },
        }));
      }
      // A different IP should be unaffected.
      const res = await POST(makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.7" },
        body: { email: "admin@demo-water.co", password: "password123" },
      }));
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/auth/signup", () => {
    it("returns 429 after exceeding the per-IP signup limit", async () => {
      const { POST } = await import("@/app/api/auth/signup/route");
      const ip = "10.0.1.1";
      const baseBody = {
        sector: "WATER_DELIVERY",
        adminName: "Test Admin",
        password: "password123",
        warehouseName: "Depot",
        warehouseAddress: "Test Address",
        warehouseLat: 24.7,
        warehouseLng: 46.6,
      };

      // Configured limit is 5/hour.
      for (let i = 0; i < 5; i++) {
        const res = await POST(makeRequest("/api/auth/signup", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { ...baseBody, companyName: `Rate Test Co ${i}`, adminEmail: `ratetest-${i}-${Date.now()}@test.co` },
        }));
        expect(res.status).toBe(201);
      }

      const blocked = await POST(makeRequest("/api/auth/signup", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { ...baseBody, companyName: "One Too Many Co", adminEmail: `onetoomany-${Date.now()}@test.co` },
      }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBeTruthy();
    });

    it("a different IP is unaffected by another IP's signup limit", async () => {
      const { POST } = await import("@/app/api/auth/signup/route");
      const baseBody = {
        sector: "WATER_DELIVERY",
        adminName: "Test Admin",
        password: "password123",
        warehouseName: "Depot",
        warehouseAddress: "Test Address",
        warehouseLat: 24.7,
        warehouseLng: 46.6,
      };
      for (let i = 0; i < 5; i++) {
        await POST(makeRequest("/api/auth/signup", {
          method: "POST",
          headers: { "x-forwarded-for": "10.0.1.2" },
          body: { ...baseBody, companyName: `Other Co ${i}`, adminEmail: `otherco-${i}-${Date.now()}@test.co` },
        }));
      }
      const res = await POST(makeRequest("/api/auth/signup", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.1.3" },
        body: { ...baseBody, companyName: "Fresh IP Co", adminEmail: `freship-${Date.now()}@test.co` },
      }));
      expect(res.status).toBe(201);
    });
  });
});
