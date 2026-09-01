import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// This locks in a real bug found during manual testing: the first version
// of the credit check only counted *invoiced* amounts. Since invoices are
// only generated at delivery (BR-18), a customer could place unlimited
// pending orders and never trip their limit. The fix (lib/creditCheck.ts)
// counts unpaid invoices PLUS the value of any order still awaiting
// delivery. These tests exist so that bug can't silently come back.
describe("B2B credit exposure (BR-04)", () => {
  let dispatcherCookie: string;
  let jarirId: string;
  let jarirLocationId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const jarir = customers.find((c: any) => c.name === "Jarir Bookstore HQ");
    jarirId = jarir.id;

    const { GET: locationsGet } = await import("@/app/api/customers/[id]/locations/route");
    const locations = await (
      await locationsGet(makeRequest(`/api/customers/${jarirId}/locations`, { cookie: dispatcherCookie }), {
        params: { id: jarirId },
      })
    ).json();
    jarirLocationId = locations[0].id;
  });

  it("allows a bulk order comfortably within the credit limit", async () => {
    const { POST } = await import("@/app/api/orders/bulk/route");
    const res = await POST(makeRequest("/api/orders/bulk", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        customerId: jarirId,
        paymentMethod: "ACCOUNT_CREDIT",
        pricePerBottle: 8,
        items: [{ locationId: jarirLocationId, qtyOrdered: 5, emptyBottlesToCollect: 0 }],
      },
    }));
    expect(res.status).toBe(201);
  });

  it("REGRESSION: blocks an order whose UNDELIVERED value alone would exceed the limit", async () => {
    // Jarir's seeded limit is 5000 SAR. Rather than guess a bottle count
    // that "should" exceed the limit (fragile — depends on exactly what
    // other tests/seed data already contributed to exposure), compute the
    // current exposure first and size this order to definitely exceed the
    // remaining headroom. The critical assertion is that this is evaluated
    // against *undelivered order value*, not invoiced amount (which would
    // be 0 here, since nothing in this test has been delivered yet).
    const { GET: statementGet } = await import("@/app/api/customers/[id]/statement/route");
    const statement = await (
      await statementGet(makeRequest(`/api/customers/${jarirId}/statement`, { cookie: dispatcherCookie }), {
        params: { id: jarirId },
      })
    ).json();
    const remaining = statement.creditAvailable as number;
    const qtyNeededToExceed = Math.ceil(remaining / (8 * 1.15)) + 10; // comfortably over

    const { POST } = await import("@/app/api/orders/bulk/route");
    const res = await POST(makeRequest("/api/orders/bulk", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        customerId: jarirId,
        paymentMethod: "ACCOUNT_CREDIT",
        pricePerBottle: 8,
        items: [{ locationId: jarirLocationId, qtyOrdered: qtyNeededToExceed, emptyBottlesToCollect: 0 }],
      },
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/credit limit/i);
  });

  it("statement's exposure figure matches unpaid invoices + undelivered order value, not just invoices", async () => {
    const { GET } = await import("@/app/api/customers/[id]/statement/route");
    const res = await GET(makeRequest(`/api/customers/${jarirId}/statement`, { cookie: dispatcherCookie }), {
      params: { id: jarirId },
    });
    const body = await res.json();

    // At this point in the suite, no deliveries have happened for Jarir,
    // so unpaid invoices should be 0 but total exposure should be > 0
    // because of the undelivered orders placed above.
    expect(body.undeliveredOrdersValue).toBeGreaterThan(0);
    expect(body.totalExposure).toBe(body.unpaidInvoicesTotal + body.undeliveredOrdersValue);
  });
});
