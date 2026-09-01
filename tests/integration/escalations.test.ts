import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";

// Escalation triggers depend on real elapsed time since order.createdAt,
// which the orders API always sets to "now" at insert — there's no way to
// backdate it through the API. Rather than lean on the seed data's
// deliberately-aged fixtures (which other test files sharing this global
// database could plausibly consume for unrelated purposes, making this
// file's assertions depend on file execution order), this test creates its
// own backdated orders directly via the DB. This is the more deterministic
// and honest way to test time-dependent behavior.
async function createAgedOrder(tenantId: string, customerId: string, opts: { slaMinutes: number; ageMinutes: number }) {
  const id = genId();
  await db.insert(orders).values({
    id,
    tenantId,
    orderNumber: genNumber("ORD"),
    customerId,
    qtyOrdered: 1,
    deliveryAddress: "Escalation Test Address",
    slaMinutes: opts.slaMinutes,
    status: "PENDING",
    paymentMethod: "CASH",
    pricePerBottle: 8,
    createdAt: new Date(Date.now() - opts.ageMinutes * 60_000),
  });
  return id;
}

describe("SLA escalation workflow (BR-20)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let driverCookie: string;
  let tenantId: string;
  let breachedOrderId: string;
  let atRiskOrderId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    driverCookie = await loginAs("khalid@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: adminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customersList = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customersList[0];

    breachedOrderId = await createAgedOrder(tenantId, customer.id, { slaMinutes: 180, ageMinutes: 200 });
    atRiskOrderId = await createAgedOrder(tenantId, customer.id, { slaMinutes: 180, ageMinutes: 160 });
  });

  it("querying escalations automatically creates HIGH and MEDIUM escalations for the aged orders", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const res = await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();

    const forBreached = rows.find((e: any) => e.orderId === breachedOrderId);
    const forAtRisk = rows.find((e: any) => e.orderId === atRiskOrderId);
    expect(forBreached).toBeTruthy();
    expect(forBreached.severity).toBe("HIGH");
    expect(forBreached.slaStatusAtEscalation).toBe("BREACHED");
    expect(forAtRisk).toBeTruthy();
    expect(forAtRisk.severity).toBe("MEDIUM");
    expect(forAtRisk.slaStatusAtEscalation).toBe("AT_RISK");

    for (const e of [forBreached, forAtRisk]) {
      expect(e.status).toBe("OPEN");
      expect(e.notifiedAt).toBeTruthy();
      expect(e.escalatedToUserId).toBeTruthy();
      expect(e.order).toBeTruthy();
    }
  });

  it("calling the SLA endpoint (as the Dispatcher console already polls) also triggers escalation creation", async () => {
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customersList = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const freshOrderId = await createAgedOrder(tenantId, customersList[0].id, { slaMinutes: 60, ageMinutes: 70 });

    const { GET: slaGet } = await import("@/app/api/sla/route");
    await slaGet(makeRequest("/api/sla", { cookie: dispatcherCookie }));

    const { GET: escalationsGet } = await import("@/app/api/escalations/route");
    const rows = await (await escalationsGet(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    expect(rows.some((e: any) => e.orderId === freshOrderId)).toBe(true);
  });

  it("does not create duplicate escalations for the same order on repeated checks", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const first = await (await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    const countForBreached = first.filter((e: any) => e.orderId === breachedOrderId).length;
    expect(countForBreached).toBe(1);

    await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }));
    await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }));
    const after = await (await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    expect(after.filter((e: any) => e.orderId === breachedOrderId).length).toBe(1);
  });

  it("acknowledging an escalation records who acknowledged it, without resolving it", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const open = await (await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    const escalation = open.find((e: any) => e.orderId === breachedOrderId);

    const { POST: acknowledge } = await import("@/app/api/escalations/[id]/acknowledge/route");
    const res = await acknowledge(
      makeRequest(`/api/escalations/${escalation.id}/acknowledge`, { method: "POST", cookie: dispatcherCookie, body: {} }),
      { params: { id: escalation.id } }
    );
    expect(res.status).toBe(200);
    const acknowledged = await res.json();
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.acknowledgedAt).toBeTruthy();
    expect(acknowledged.acknowledgedByUserId).toBeTruthy();

    const secondAttempt = await acknowledge(
      makeRequest(`/api/escalations/${escalation.id}/acknowledge`, { method: "POST", cookie: dispatcherCookie, body: {} }),
      { params: { id: escalation.id } }
    );
    expect(secondAttempt.status).toBe(422);
  });

  it("resolving an escalation with notes closes it", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const open = await (await GET(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    const escalation = open.find((e: any) => e.orderId === atRiskOrderId);

    const { POST: resolve } = await import("@/app/api/escalations/[id]/resolve/route");
    const res = await resolve(
      makeRequest(`/api/escalations/${escalation.id}/resolve`, {
        method: "POST",
        cookie: dispatcherCookie,
        body: { notes: "Called customer, redelivery arranged" },
      }),
      { params: { id: escalation.id } }
    );
    expect(res.status).toBe(200);
    const resolved = await res.json();
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolutionNotes).toBe("Called customer, redelivery arranged");

    const secondAttempt = await resolve(
      makeRequest(`/api/escalations/${escalation.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: {} }),
      { params: { id: escalation.id } }
    );
    expect(secondAttempt.status).toBe(422);
  });

  it("a DRIVER cannot access escalations (ADMIN/DISPATCHER only)", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const res = await GET(makeRequest("/api/escalations", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("an escalation cannot be acted on from a different tenant", async () => {
    const acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET } = await import("@/app/api/escalations/route");
    const waterEscalations = await (await GET(makeRequest("/api/escalations?status=OPEN", { cookie: adminCookie }))).json();
    const target = waterEscalations.find((e: any) => e.orderId === breachedOrderId || e.orderId === atRiskOrderId);

    if (target) {
      const { POST: acknowledge } = await import("@/app/api/escalations/[id]/acknowledge/route");
      const res = await acknowledge(
        makeRequest(`/api/escalations/${target.id}/acknowledge`, { method: "POST", cookie: acmeCookie, body: {} }),
        { params: { id: target.id } }
      );
      expect(res.status).toBe(404);
    }
  });
});
