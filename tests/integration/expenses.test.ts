import { ensureAllSeries } from "../helpers/testFixtures";
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("expense claim workflow (BR-23)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let khalidCookie: string;
  let fahadCookie: string;
  let khalidDriverId: string;
  let vehicleId: string;

  beforeAll(async () => {
    // RC1: ensure all numbering series exist
    try { const { tenants: _t } = await import("@/lib/db/schema"); const { db: _db } = await import("@/lib/db/client"); const { eq: _eq } = await import("drizzle-orm"); const _acme = await _db.query.tenants.findFirst({ where: _eq(_t.name, "Acme Fuel Delivery Co.") }); const _demo = await _db.query.tenants.findFirst({ where: _eq(_t.name, "Demo Water Co.") }); if (_acme) await ensureAllSeries(_acme.id); if (_demo) await ensureAllSeries(_demo.id); } catch {}
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    khalidCookie = await loginAs("khalid@demo-water.co", "password123");
    fahadCookie = await loginAs("fahad@demo-water.co", "password123");

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    khalidDriverId = drivers.find((d: any) => d.user.email === "khalid@demo-water.co").id;

    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    vehicleId = vehicles[0].id;
  });

  it("rejects an expense with neither a trip nor a reason", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST",
      cookie: khalidCookie,
      body: { driverId: khalidDriverId, vehicleId, category: "FUEL", amount: 150 },
    }));
    expect(res.status).toBe(400);
  });

  it("a driver submits a valid expense claim with a reason, starting as PENDING", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST",
      cookie: khalidCookie,
      body: {
        driverId: khalidDriverId,
        vehicleId,
        category: "TOLL",
        amount: 25,
        reason: "Highway toll on the way to Al Yasmin district",
        receiptDescription: "Paper receipt, toll gate 4",
      },
    }));
    expect(res.status).toBe(201);
    const claim = await res.json();
    expect(claim.status).toBe("PENDING");
    expect(claim.driver.user.name).toBe("Khalid Driver");
  });

  it("a driver cannot submit an expense under another driver's profile", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST",
      cookie: fahadCookie,
      body: { driverId: khalidDriverId, vehicleId, category: "FUEL", amount: 100, reason: "Test" },
    }));
    expect(res.status).toBe(403);
  });

  it("a driver only sees their own expense claims", async () => {
    const { GET } = await import("@/app/api/expenses/route");
    const khalidClaims = await (await GET(makeRequest("/api/expenses", { cookie: khalidCookie }))).json();
    expect(khalidClaims.length).toBeGreaterThan(0);
    expect(khalidClaims.every((c: any) => c.driverId === khalidDriverId)).toBe(true);

    const fahadClaims = await (await GET(makeRequest("/api/expenses", { cookie: fahadCookie }))).json();
    expect(fahadClaims.every((c: any) => c.driverId !== khalidDriverId)).toBe(true);
  });

  it("an ADMIN can approve a pending claim, and cannot approve it twice", async () => {
    const { POST: createExpense } = await import("@/app/api/expenses/route");
    const claim = await (
      await createExpense(makeRequest("/api/expenses", {
        method: "POST",
        cookie: khalidCookie,
        body: { driverId: khalidDriverId, vehicleId, category: "MAINTENANCE", amount: 300, reason: "Emergency tyre repair on route" },
      }))
    ).json();

    const { POST: approve } = await import("@/app/api/expenses/[id]/approve/route");
    const res = await approve(makeRequest(`/api/expenses/${claim.id}/approve`, { method: "POST", cookie: adminCookie }), {
      params: { id: claim.id },
    });
    expect(res.status).toBe(200);
    const approved = await res.json();
    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedByUserId).toBeTruthy();

    const secondAttempt = await approve(makeRequest(`/api/expenses/${claim.id}/approve`, { method: "POST", cookie: adminCookie }), {
      params: { id: claim.id },
    });
    expect(secondAttempt.status).toBe(422);
  });

  it("an ADMIN can reject a pending claim with notes", async () => {
    const { POST: createExpense } = await import("@/app/api/expenses/route");
    const claim = await (
      await createExpense(makeRequest("/api/expenses", {
        method: "POST",
        cookie: khalidCookie,
        body: { driverId: khalidDriverId, vehicleId, category: "OTHER", amount: 500, reason: "Miscellaneous" },
      }))
    ).json();

    const { POST: reject } = await import("@/app/api/expenses/[id]/reject/route");
    const res = await reject(
      makeRequest(`/api/expenses/${claim.id}/reject`, { method: "POST", cookie: adminCookie, body: { reviewNotes: "Missing itemized receipt" } }),
      { params: { id: claim.id } }
    );
    expect(res.status).toBe(200);
    const rejected = await res.json();
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reviewNotes).toBe("Missing itemized receipt");
  });

  it("(RC1) a DISPATCHER cannot view expenses — RBAC enforcement blocks the expenses module", async () => {
    const { GET } = await import("@/app/api/expenses/route");
    // RC1 RBAC: DISPATCHER does not have the "expenses" module — correctly returns 403
    expect((await GET(makeRequest("/api/expenses", { cookie: dispatcherCookie }))).status).toBe(403);

    const { POST: createExpense } = await import("@/app/api/expenses/route");
    const claim = await (
      await createExpense(makeRequest("/api/expenses", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: khalidDriverId, vehicleId, category: "FUEL", amount: 80, reason: "Dispatcher-filed expense" },
      }))
    ).json();

    const { POST: approve } = await import("@/app/api/expenses/[id]/approve/route");
    const res = await approve(makeRequest(`/api/expenses/${claim.id}/approve`, { method: "POST", cookie: dispatcherCookie }), {
      params: { id: claim.id },
    });
    expect(res.status).toBe(401);
  });

  it("submitting an expense fires the EXPENSE_SUBMITTED automation event", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const rule = await (
      await createRule(makeRequest("/api/automation/rules", {
        method: "POST",
        cookie: adminCookie,
        body: {
          name: "Notify on large fuel expenses",
          eventType: "EXPENSE_SUBMITTED",
          conditions: [{ field: "category", operator: "eq", value: "FUEL" }, { field: "amount", operator: "gt", value: 200 }],
          action: "NOTIFY",
          actionConfig: { message: "Large fuel expense: {{amount}} SAR" },
        },
      }))
    ).json();

    const { POST: createExpense } = await import("@/app/api/expenses/route");
    await createExpense(makeRequest("/api/expenses", {
      method: "POST",
      cookie: khalidCookie,
      body: { driverId: khalidDriverId, vehicleId, category: "FUEL", amount: 350, reason: "Full tank before long route" },
    }));

    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logs = await (await logsGet(makeRequest("/api/automation/logs", { cookie: adminCookie }))).json();
    expect(logs.some((l: any) => l.ruleId === rule.id && l.status === "FIRED")).toBe(true);
  });
});
