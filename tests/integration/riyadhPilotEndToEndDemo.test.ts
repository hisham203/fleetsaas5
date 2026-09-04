import { describe, it, expect } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules, warehouses, drivers, users, vehicles, orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task O — Riyadh Bulk Water End-to-End Pilot Demo Audit. Walks the
// exact demo journey this task specifies, step by step, using the real
// seeded Riyadh tenant/customers/loading point wherever the journey
// itself would use them, plus a dedicated isolated driver/vehicle (the
// established pattern from every prior task) to avoid any contention
// with the shared seeded fleet.
describe("Riyadh Bulk Water end-to-end pilot demo journey (Task O)", () => {
  it("steps 1-12: admin setup visibility, dispatcher assignment, loading, dispatch, driver delivery, and monthly billing preview all work together", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    expect(tenant, "Riyadh Bulk Water Logistics tenant must exist").toBeTruthy();
    const tenantId = tenant!.id;

    // --- Step 1: Admin login ---
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    expect(adminCookie).toBeTruthy();

    // --- Step 2: Review Riyadh tenant/customer/site/contract/loading point configuration ---
    const { GET: getCustomers } = await import("@/app/api/customers/route");
    const customersRes = await getCustomers(makeRequest(`/api/customers?tenantId=${tenantId}`, { cookie: adminCookie }));
    expect(customersRes.status).toBe(200);
    const customersList = await customersRes.json();
    expect(customersList.length).toBeGreaterThanOrEqual(6);

    const { GET: getContracts } = await import("@/app/api/contracts/route");
    const contractsRes = await getContracts(makeRequest("/api/contracts", { cookie: adminCookie }));
    const contractsList = await contractsRes.json();
    // Prefer a contract that applies to all sites — the simplest real
    // demo path, since a site-restricted contract legitimately requires
    // the order to specify a matching locationId (correct, existing
    // eligibility validation, not something to route around here).
    const monthlyContract =
      contractsList.find((c: any) => c.type === "MONTHLY_ACCUMULATED" && c.status === "ACTIVE" && c.appliesToAllSites) ??
      contractsList.find((c: any) => c.type === "MONTHLY_ACCUMULATED" && c.status === "ACTIVE");
    expect(monthlyContract, "at least one ACTIVE MONTHLY_ACCUMULATED Riyadh contract must exist").toBeTruthy();

    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    expect(loadingPoint, "a Riyadh loading point must exist").toBeTruthy();

    // A real pricing rule must exist for this contract, or the demo's
    // pricing preview step would legitimately show NOT_READY — confirm
    // it's actually configured, not just assume it.
    const pricingRules = await db.query.contractPricingRules.findMany({ where: eq(contractPricingRules.contractId, monthlyContract.id) });
    expect(pricingRules.some((r) => r.rateType === "STANDARD"), "the demo contract needs a STANDARD pricing rule to be billable").toBe(true);

    // --- Step 3: Dispatcher login ---
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    expect(dispatcherCookie).toBeTruthy();

    // Isolated driver + vehicle, matching the established pattern —
    // avoids contending with the shared seeded fleet other tests use.
    // The helper's own vehicle is a generic "Refill Van" (capacityUnits),
    // not a tanker — create a dedicated tanker vehicle instead, matching
    // what the real Riyadh demo actually uses.
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `o-demo-${genId().slice(0, 6)}`);
    const driverId = isolated.driverId;
    const driverCookie = isolated.driverCookie;
    const vehicleId = genId();
    await db.insert(vehicles).values({ id: vehicleId, tenantId, plateNumber: `O-TEST-${genId().slice(0, 8)}`, vehicleType: "Water Tanker", capacityLiters: 21000, status: "AVAILABLE" });

    // Find a real Riyadh customer this monthly contract applies to.
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, monthlyContract.customerId) });
    expect(customer).toBeTruthy();

    // --- Step 4: Create a pending order, linked to the contract, as a dispatcher would ---
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const orderRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: dispatcherCookie,
      body: { tenantId, customerId: customer!.id, contractId: monthlyContract.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(orderRes.status, "order creation must succeed for the demo journey to proceed at all").toBe(201);
    const order = await orderRes.json();
    expect(order.status).toBe("PENDING");
    // Note: bottleSizeLtr exists on every order regardless of tenant
    // (a schema-level default, never set to anything else for any
    // tenant — confirmed in Task N's own audit) but is never rendered
    // anywhere in the dispatch UI (verified at the source level by
    // Task G.3/N's own tests) — its mere presence on the raw API object
    // is not itself bottle-era UI confusion.

    // --- Step 5: Assign tanker/driver/loading point ---
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const tripRes = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: dispatcherCookie,
      body: { driverId, vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
    }));
    expect(tripRes.status, "trip assignment must succeed — this is the exact scenario Task G.3 fixed").toBe(201);
    const trip = await tripRes.json();
    expect(trip.status).toBe("PLANNED");

    // Duplicate-assignment guard: the same order cannot be assigned twice.
    const dupTripRes = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: dispatcherCookie,
      body: { driverId, vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
    }));
    expect(dupTripRes.status).toBe(422);

    // --- Step 6: Confirm loading (zero-inventory Riyadh loading point) ---
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const loadingRes = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), { params: { id: trip.id } });
    expect(loadingRes.status, "loading confirmation must succeed for a zero-inventory tanker loading point").toBe(200);
    const loadedTrip = await loadingRes.json();
    expect(loadedTrip.loadingConfirmed).toBe(true);

    // --- Step 7: Dispatch trip ---
    const { PATCH: patchTrip } = await import("@/app/api/trips/[id]/route");
    const dispatchRes = await patchTrip(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }),
      { params: { id: trip.id } }
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchedTrip = await dispatchRes.json();
    expect(dispatchedTrip.status).toBe("DISPATCHED");

    // --- Steps 8-9: Driver login, driver sees correct trip ---
    const { GET: getTrips } = await import("@/app/api/trips/route");
    const driverTripsRes = await getTrips(makeRequest(`/api/trips?tenantId=${tenantId}`, { cookie: driverCookie }));
    expect(driverTripsRes.status).toBe(200);
    const driverTrips = await driverTripsRes.json();
    const myTrip = driverTrips.find((t: any) => t.id === trip.id);
    expect(myTrip, "the driver must be able to see their own dispatched trip").toBeTruthy();
    expect(myTrip.status).toBe("DISPATCHED");
    expect(myTrip.driver.user.name).toContain("Isolated Test Driver");

    // --- Step 10: Complete delivery / ePOD minimum flow ---
    const firstStop = myTrip.stops[0];
    const { PATCH: resolveStop } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const deliverRes = await resolveStop(
      makeRequest(`/api/trips/${trip.id}/stops/${firstStop.id}`, {
        method: "PATCH", cookie: driverCookie,
        body: { action: "deliver", deliveredQty: 1, emptiesCollected: 0, recipientName: "Task O Test Recipient" },
      }),
      { params: { id: trip.id, stopId: firstStop.id } }
    );
    expect(deliverRes.status, "delivery completion must succeed with the minimum ePOD fields").toBe(200);
    const deliveredStop = await deliverRes.json();
    expect(deliveredStop.stop.status).toBe("DELIVERED");
    expect(deliveredStop.stop.epod).toBeTruthy();
    expect(deliveredStop.stop.epod.deliveredQty).toBe(1);
    expect(deliveredStop.stop.epod.recipientName).toBe("Task O Test Recipient");

    // Close the trip out, matching the natural next dispatcher action.
    const completeRes = await patchTrip(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: adminCookie, body: { action: "complete" } }),
      { params: { id: trip.id } }
    );
    expect(completeRes.status).toBe(200);

    // --- Step 11: Admin/dispatcher can see the completed trip ---
    const finalTripsRes = await getTrips(makeRequest(`/api/trips?tenantId=${tenantId}`, { cookie: adminCookie }));
    const finalTrips = await finalTripsRes.json();
    const completedTrip = finalTrips.find((t: any) => t.id === trip.id);
    expect(completedTrip.status).toBe("COMPLETED");
    expect(completedTrip.stops[0].status).toBe("DELIVERED");
    expect(completedTrip.stops[0].epod.deliveredQty).toBe(1);

    // The order itself reflects the same completed state.
    const updatedOrder = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(updatedOrder!.status).toBe("DELIVERED");
    expect(updatedOrder!.completedAt).toBeTruthy();

    // --- Step 12: Monthly billing preview reflects the completed eligible trip ---
    const { GET: getPreview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const previewRes = await getPreview(makeRequest(`/api/contracts/${monthlyContract.id}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: monthlyContract.id } });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.eligibleOrderIds).toContain(order.id);
    expect(preview.readiness).toBe("READY");
    expect(preview.expectedTotal).toBeGreaterThan(0);

    // Confirm this preview call itself created no invoice — Task I.5A's
    // own guarantee, re-verified here in the context of a real completed
    // demo trip specifically (not just a synthetic fixture).
    const { invoices, invoiceLineItems } = await import("@/lib/db/schema");
    const anyDirectInvoiceForThisOrder = await db.query.invoices.findFirst({ where: eq(invoices.orderId, order.id) });
    const anyLineItemForThisOrder = await db.query.invoiceLineItems.findFirst({ where: eq(invoiceLineItems.orderId, order.id) });
    expect(anyDirectInvoiceForThisOrder, "a MONTHLY_ACCUMULATED order must not get a direct single-order invoice at delivery (Task E.1)").toBeFalsy();
    expect(anyLineItemForThisOrder, "the preview itself must never create an invoice line item").toBeFalsy();
  });

  it("no passwordHash exposure anywhere across the full journey's own API responses", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getCustomers } = await import("@/app/api/customers/route");
    const { GET: getTrips } = await import("@/app/api/trips/route");
    const [custText, tripsText] = await Promise.all([
      getCustomers(makeRequest(`/api/customers?tenantId=${tenant!.id}`, { cookie: adminCookie })).then((r) => r.text()),
      getTrips(makeRequest(`/api/trips?tenantId=${tenant!.id}`, { cookie: adminCookie })).then((r) => r.text()),
    ]);
    expect(custText).not.toContain("passwordHash");
    expect(tripsText).not.toContain("passwordHash");
  });
});
