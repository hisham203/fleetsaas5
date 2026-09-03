import { describe, it, expect, vi, afterEach } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contractPricingRules } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// S1 hotfix: GET /api/invoices was returning a bare 500 with no body
// (client-side "Unexpected end of JSON input"), which froze the Admin
// page's "Loading…" state forever because Promise.all rejected as soon
// as one of its six fetches did. These tests prove: (1) the normal
// listing still works exactly as before, (2) the response never contains
// passwordHash, (3) a genuinely-thrown internal error still produces a
// valid, parseable JSON error response rather than an empty body, and
// (4) a fully realistic contract-linked, delivered order (the newest,
// least-exercised data shape, from Task C/D/D.5) doesn't break the deep
// embed chain.
describe("GET /api/invoices — S1 hotfix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1/4. lists existing invoices successfully for the standard, already-seeded delivery data", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("2. the response is always valid, parseable JSON — success path", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie }));
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text.length).toBeGreaterThan(0);
  });

  it("3. the response never contains passwordHash on the embedded customer or driver user", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie }));
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });

  it("regression: a fully realistic contract-linked, delivered order (Task C/D/D.5 data shape) doesn't break the invoice listing", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const jarirId = (await (await customersGet(makeRequest("/api/customers", { cookie }))).json()).find((c: any) => c.name === "Jarir Bookstore HQ").id;

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }))).json();

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie }))).json()).find((w: any) => w.isDefault).id;
    const isolated = await createIsolatedDriverAndVehicle(tenantId, "invoices-hotfix-regression");

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
    }))).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie, body: { action: "dispatch" } }), { params: { id: trip.id } });

    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 2, emptiesCollected: 2, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );

    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain("passwordHash");
    const body = JSON.parse(text);
    const found = body.find((i: any) => i.orderId === order.id);
    expect(found).toBeTruthy();
    expect(found.order.contractId).toBe(contract.id);
  });

  it("5/6. a genuinely thrown internal error still returns a valid, parseable JSON 500 — not an empty body", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    vi.spyOn(db.query.invoices, "findMany").mockRejectedValue(new Error("simulated internal failure"));

    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0); // never an empty body
    expect(() => JSON.parse(text)).not.toThrow(); // always valid JSON, even on failure
    const body = JSON.parse(text);
    expect(body.error).toBeTruthy();
  });

  it("rejects non-ADMIN/DISPATCHER roles, and that response is also valid JSON", async () => {
    const driverCookie = await loginAs("khalid@demo-water.co", "password123");
    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(makeRequest("/api/invoices", { cookie: driverCookie }));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
