import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, contractSiteScope, customerLocations, vehicles } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { eq } from "drizzle-orm";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task D.5 — Vehicle Capacity Pricing Preview at Trip Assignment. These
// tests prove pricing preview becomes more accurate (capacityKnown: true,
// using the real assigned vehicle's capacityLiters) once a trip is
// created, on top of everything already proven for order-creation-time
// preview in Task D. Every test creates its own dedicated driver/vehicle
// via the same isolation fixture already used to fix the CI test
// determinism issue — this file never depends on a shared seeded
// driver/vehicle pool.
describe("Trip creation — vehicle capacity pricing preview (Task D.5)", () => {
  let waterAdminCookie: string;
  let tenantId: string;
  let jarirId: string;
  let mainWarehouseId: string;
  let jarirLocationId: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json();
    jarirId = customers.find((c: any) => c.name === "Jarir Bookstore HQ").id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json();
    mainWarehouseId = warehouses.find((w: any) => w.isDefault).id;

    const location = await db.query.customerLocations.findFirst({ where: (l, { eq: eqOp }) => eqOp(l.customerId, jarirId) });
    jarirLocationId = location!.id;
    await db.update(customerLocations).set({ cityCode: "RUH", zoneCode: "ZONE_A", distanceBandCode: "BAND_1" }).where(eq(customerLocations.id, jarirLocationId));
  });

  async function createActiveContract(overrides: Partial<{ type: string; totalTripsPurchased: number; billingCadence: string; appliesToAllSites: boolean }> = {}) {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: {
        customerId: jarirId,
        type: overrides.type ?? "ONE_TIME_TRIP_COUNT",
        totalTripsPurchased: overrides.type === "MONTHLY_ACCUMULATED" ? undefined : (overrides.totalTripsPurchased ?? 10),
        billingCadence: overrides.type === "MONTHLY_ACCUMULATED" ? "MONTHLY" : undefined,
        appliesToAllSites: overrides.appliesToAllSites ?? true,
        startDate: "2020-01-01",
      },
    }))).json();
    await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    return contract.id;
  }

  async function createContractOrder(contractId: string, opts: { locationId?: string; qtyOrdered?: number } = {}) {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const res = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: {
        customerId: jarirId, contractId, locationId: opts.locationId,
        qtyOrdered: opts.qtyOrdered ?? 1, emptyBottlesToCollect: opts.qtyOrdered ?? 1, paymentMethod: "CASH",
      },
    }));
    return res.json();
  }

  async function createTripWithCapacity(orderId: string, capacityLiters: number | null, label: string) {
    const isolated = await createIsolatedDriverAndVehicle(tenantId, label);
    if (capacityLiters != null) {
      await db.update(vehicles).set({ capacityLiters }).where(eq(vehicles.id, isolated.vehicleId));
    }
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: mainWarehouseId, orderIds: [orderId] },
    }));
    return { res, vehicleId: isolated.vehicleId };
  }

  // ---------- Existing behavior ----------

  it("1. existing trip creation for non-contract orders still works, no pricingPreview key on the stop", async () => {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const plainOrder = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }))).json();

    const { res } = await createTripWithCapacity(plainOrder.id, 18000, "d5-plain");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stops[0].pricingPreview).toBeUndefined();
  });

  // ---------- Vehicle capacity pricing ----------

  it("3/4/5. a contract-linked order is capacityKnown=false at order creation, then capacityKnown=true with the selected vehicle's capacity at trip creation", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: 21000, pricePerTrip: 550, vatRate: 0.15 });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 }); // wildcard fallback

    const order = await createContractOrder(contractId, { locationId: jarirLocationId });
    expect(order.pricingPreview.capacityKnown).toBe(false); // order-creation time — Task D behavior, unchanged

    const { res } = await createTripWithCapacity(order.id, 21000, "d5-known-capacity");
    expect(res.status).toBe(201);
    const body = await res.json();
    const stop = body.stops.find((s: any) => s.order.id === order.id);
    expect(stop.pricingPreview.capacityKnown).toBe(true);
    expect(stop.pricingPreview.baseAmount).toBe("550.00"); // the capacity-specific rule, not the wildcard
  });

  it("6/7. a capacity-specific rule beats a wildcard rule, and a different vehicle capacity selects a different rule", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 }, // wildcard
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: 18000, pricePerTrip: 420, vatRate: 0.15 },
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: 28000, pricePerTrip: 680, vatRate: 0.15 },
    ]);

    const orderA = await createContractOrder(contractId);
    const { res: resA } = await createTripWithCapacity(orderA.id, 18000, "d5-cap-18k");
    const bodyA = await resA.json();
    expect(bodyA.stops[0].pricingPreview.baseAmount).toBe("420.00");

    const orderB = await createContractOrder(contractId);
    const { res: resB } = await createTripWithCapacity(orderB.id, 28000, "d5-cap-28k");
    const bodyB = await resB.json();
    expect(bodyB.stops[0].pricingPreview.baseAmount).toBe("680.00");
  });

  it("8. a missing capacity-specific rule still uses a valid wildcard rule", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 });
    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-wildcard-fallback"); // no 21000-specific rule exists
    const body = await res.json();
    expect(body.stops[0].pricingPreview.available).toBe(true);
    expect(body.stops[0].pricingPreview.baseAmount).toBe("300.00");
  });

  it("9. a genuinely missing rule returns pricingPreview.available=false with a clear error, trip still succeeds", async () => {
    const contractId = await createActiveContract(); // zero pricing rules
    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-no-rule");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stops[0].pricingPreview.available).toBe(false);
    expect(body.stops[0].pricingPreview.errorCode).toBe("NO_MATCHING_RULE");
  });

  // ---------- Contract/site/location ----------

  it("10/11. a site-restricted contract with a scoped location still works, and its city/zone/band still reach the pricing engine at trip creation", async () => {
    const contractId = await createActiveContract({ appliesToAllSites: false });
    await db.insert(contractSiteScope).values({ id: genId(), contractId, customerLocationId: jarirLocationId });
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 200, vatRate: 0.15 }, // wildcard
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", zoneCode: "ZONE_A", distanceBandCode: "BAND_1", tankerCapacityLtr: 21000, pricePerTrip: 610, vatRate: 0.15 },
    ]);
    const order = await createContractOrder(contractId, { locationId: jarirLocationId });
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-site-restricted");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stops[0].pricingPreview.baseAmount).toBe("610.00"); // the fully-specific rule, proving city/zone/band reached the engine
  });

  it("12. an unscoped site is rejected at ORDER creation, before a trip is ever attempted", async () => {
    const contractId = await createActiveContract({ appliesToAllSites: false }); // jarirLocationId never scoped to this one
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const res = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422); // never reaches trip creation at all
  });

  // ---------- Overage ----------

  it("13/14. ONE_TIME_TRIP_COUNT uses STANDARD within limit and OVERAGE once exhausted, at trip assignment", async () => {
    const contractId = await createActiveContract({ totalTripsPurchased: 2 });
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 },
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "OVERAGE", pricePerTrip: 750, vatRate: 0.15 },
    ]);

    const withinLimitOrder = await createContractOrder(contractId);
    const { res: withinRes } = await createTripWithCapacity(withinLimitOrder.id, 21000, "d5-within-limit");
    expect((await withinRes.json()).stops[0].pricingPreview.rateType).toBe("STANDARD");

    await db.update(contracts).set({ tripsUsed: 2 }).where(eq(contracts.id, contractId));
    const exhaustedOrder = await createContractOrder(contractId);
    const { res: exhaustedRes } = await createTripWithCapacity(exhaustedOrder.id, 21000, "d5-exhausted");
    expect(exhaustedRes.status).toBe(201);
    expect((await exhaustedRes.json()).stops[0].pricingPreview.rateType).toBe("OVERAGE");
  });

  it("15. a missing OVERAGE rule returns a clear preview error, never falling back to STANDARD, trip still succeeds", async () => {
    const contractId = await createActiveContract({ totalTripsPurchased: 1 });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    await db.update(contracts).set({ tripsUsed: 1 }).where(eq(contracts.id, contractId));

    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-missing-overage");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stops[0].pricingPreview.available).toBe(false);
    expect(body.stops[0].pricingPreview.errorCode).toBe("MISSING_OVERAGE_RULE");
  });

  it("MONTHLY_ACCUMULATED always uses STANDARD at trip assignment", async () => {
    const contractId = await createActiveContract({ type: "MONTHLY_ACCUMULATED" });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 380, vatRate: 0.15 });
    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-monthly");
    expect((await res.json()).stops[0].pricingPreview.rateType).toBe("STANDARD");
  });

  // ---------- Safety ----------

  it("16/17/19. trip creation with pricing preview creates no invoice, no invoice_line_items, and mutates no pricing rule", async () => {
    const contractId = await createActiveContract();
    const ruleId = genId();
    await db.insert(contractPricingRules).values({ id: ruleId, tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    const invoicesBefore = await db.query.invoices.findMany();
    const lineItemsBefore = await db.query.invoiceLineItems.findMany();
    const ruleBefore = await db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.id, ruleId) });

    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-no-invoice");
    expect((await res.json()).stops[0].pricingPreview.available).toBe(true);

    const invoicesAfter = await db.query.invoices.findMany();
    const lineItemsAfter = await db.query.invoiceLineItems.findMany();
    const ruleAfter = await db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.id, ruleId) });
    expect(invoicesAfter.length).toBe(invoicesBefore.length);
    expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
    expect(ruleAfter).toEqual(ruleBefore);
  });

  it("18. tripsUsed is not mutated by trip creation", async () => {
    const contractId = await createActiveContract({ totalTripsPurchased: 5 });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    const order = await createContractOrder(contractId);
    await createTripWithCapacity(order.id, 21000, "d5-tripsused");
    const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    expect(contract!.tripsUsed).toBe(0);
  });

  it("20. an order without contractId is unaffected by any of this", async () => {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-unaffected");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stops[0].pricingPreview).toBeUndefined();
  });

  it("21. no passwordHash or sensitive customer fields anywhere in the trip creation response", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    const order = await createContractOrder(contractId);
    const { res } = await createTripWithCapacity(order.id, 21000, "d5-security");
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });
});
