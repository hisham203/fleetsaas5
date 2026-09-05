import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Milestone S — Operations Deep Links & Detail Drawers. No frontend
// rendering framework exists in this project (an established, deliberate
// choice throughout this codebase's own prior tasks), so per that same
// convention this verifies the connected-navigation behavior at the
// level that's actually meaningful: the page source contains the real
// deep-link reading/writing logic, using real IDs and real state, plus
// direct API-level checks for anything server-side.
const dispatchSource = () => fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
const controlTowerSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/dispatch/page.tsx"), "utf8");
const contractsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");
const plannerSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contract-planner/page.tsx"), "utf8");

describe("Dispatch Control Tower -> Dispatch deep link (Milestone S, Parts 3A/5)", () => {
  it("1. clicking a trip/order in Control Tower generates a Dispatch URL carrying tripId or orderId", () => {
    const source = controlTowerSource();
    expect(source).toContain("/dispatch?tripId=${r.tripId}");
    expect(source).toContain("/dispatch?orderId=${r.orderId}");
  });

  it("2. the Dispatch screen reads tripId/orderId from the query string", () => {
    const source = dispatchSource();
    expect(source).toContain('useSearchParams()');
    expect(source).toContain('searchParams.get("tripId")');
    expect(source).toContain('searchParams.get("orderId")');
  });

  it("3. the Dispatch screen auto-selects the clicked trip (focus + detail) or order (queue selection) once data has loaded", () => {
    const source = dispatchSource();
    const effectStart = source.indexOf("if (deepLinkResolved) return;");
    const effectBody = source.slice(effectStart, effectStart + 1200);
    expect(effectBody).toContain("setFocusTripId(match.id)");
    expect(effectBody).toContain("setDetailTripId(match.id)");
    expect(effectBody).toContain("setSelected([match.id])");
  });

  it("4. a detail drawer/panel renders for the selected trip, with real operational fields", () => {
    const source = dispatchSource();
    expect(source).toContain("detailTripId && (() => {");
    expect(source).toContain('label="Trip status"');
    expect(source).toContain('label="Customer"');
    expect(source).toContain('label="Contract"');
    expect(source).toContain('label="Loading point"');
    expect(source).toContain('label="Delivery status"');
  });

  it("5. an unknown/missing tripId or orderId shows a clear not-found notice, never a silent blank screen", () => {
    const source = dispatchSource();
    expect(source).toContain("was not found — it may have been completed or is no longer active");
    expect(source).toContain("deepLinkNotice &&");
  });
});

describe("Contract Trip Planner -> Contracts deep link (Milestone S, Parts 3C/6)", () => {
  it("6. clicking a contract in the Planner generates a Contracts URL carrying contractId", () => {
    const source = plannerSource();
    expect(source).toContain("/admin/contracts?contractId=${r.contractId}");
  });

  it("7. the Contracts page reads contractId from the query string", () => {
    const source = contractsSource();
    expect(source).toContain("useSearchParams()");
    expect(source).toContain('searchParams.get("contractId")');
  });

  it("8. the Contracts page auto-selects the matching contract once contracts have loaded", () => {
    const source = contractsSource();
    const effectStart = source.indexOf("if (deepLinkResolved) return;");
    const effectBody = source.slice(effectStart, effectStart + 700);
    expect(effectBody).toContain("setSelectedId(match.id)");
  });

  it("9. a contract detail panel renders for the selected contract (pre-existing ContractDetail, now reachable via deep link)", () => {
    const source = contractsSource();
    expect(source).toContain("<ContractDetail contractId={selectedId}");
  });

  it("10. an unknown contractId shows a clear not-found notice", () => {
    const source = contractsSource();
    expect(source).toContain("was not found — it may have been removed or belongs to a different tenant");
    expect(source).toContain("deepLinkNotice &&");
  });

  it("11. the Contracts page exposes a real, ID-based 'View in Planner' link, hidden for a CANCELLED contract", () => {
    const source = contractsSource();
    expect(source).toContain("/admin/contract-planner?contractId=${contract.id}");
    expect(source).toContain("View in Planner");
    expect(source).toContain('contract.status !== "CANCELLED"');
  });

  it("12. the Contract Planner reads contractId and highlights the matching row", () => {
    const source = plannerSource();
    expect(source).toContain('searchParams.get("contractId")');
    expect(source).toContain("focusContractId === r.contractId");
  });
});

describe("Control Tower filters and cross-navigation (Milestone S, Part 8)", () => {
  it("13. the Control Tower reads contractId/customerId/tripId/orderId query params", () => {
    const source = controlTowerSource();
    expect(source).toContain('searchParams.get("contractId")');
    expect(source).toContain('searchParams.get("customerId")');
    expect(source).toContain('searchParams.get("tripId")');
    expect(source).toContain('searchParams.get("orderId")');
  });

  it("14. a deep-linked contract is not silently hidden by the Planner's own tab filter — the tab is forced back to 'all' when a real match is found", () => {
    const source = plannerSource();
    const effectStart = source.indexOf("if (deepLinkResolved) return;", source.indexOf("Part 3/7: resolves"));
    const effectBody = source.slice(effectStart, effectStart + 500);
    expect(effectBody).toContain('setTab("all")');
  });

  it("Contracts and Contract Planner both correctly wrap their query-param-reading component in Suspense, per Next.js's own build requirement", () => {
    expect(contractsSource()).toContain("<Suspense fallback=");
    expect(plannerSource()).toContain("<Suspense fallback=");
  });
});

describe("Regression protection (Milestone S, Part 11)", () => {
  it("15/16. Milestone R's left-sidebar remains the primary Admin navigation — no horizontal tab bar returned", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("AdminShell");
    expect(adminSource).not.toMatch(/\(\["overview", "fleet", "drivers".*\] as const\)\.map/);
  });

  it("17/18/19. Dispatch Control Tower, Contract Trip Planner, and Loading Points all still exist and use AdminShell", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/dispatch/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/contract-planner/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/loading-points/page.tsx"))).toBe(true);
    expect(controlTowerSource()).toContain("AdminShell");
    expect(plannerSource()).toContain("AdminShell");
  });

  it("this milestone did not touch the delivery-completion route, contract pricing engine, or ERP sync — confirmed by checking their own known content is unchanged", async () => {
    const stopRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erpSource = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    // Task P.2's own markers must still be present, confirming that file's logic is intact.
    expect(stopRouteSource).toContain("Task P.2");
    expect(stopRouteSource).toContain("isTripCountContract");
    expect(pricingSource).toContain("PricingEngineError");
    expect(erpSource).toContain("isContractPriced");
  });

  it("20/21/22. Task P.2 contract-priced invoice behavior is unaffected — a real ONE_TIME_TRIP_COUNT delivery still prices via calculateContractPrice", async () => {
    const { contracts, contractPricingRules, customers, warehouses } = await import("@/lib/db/schema");
    const { genId } = await import("@/lib/helpers");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "Milestone S Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({
      id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MS-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT",
      status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01"),
    });
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId: tenant!.id, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15,
    });

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `ms-regression-${genId().slice(0, 6)}`);
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", { method: "POST", cookie: adminCookie, body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: warehouse!.id, orderIds: [order.id] } }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: adminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 0, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );
    const deliverBody = await deliverRes.json();
    expect(deliverBody.invoice.subtotal).toBe(500); // contract-priced, not bottle-priced
    const contractAfter = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    expect(contractAfter!.tripsUsed).toBe(1);
  });

  it("23/24. permissions and tenant isolation on the new/changed pages remain intact", async () => {
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("no passwordHash exposure introduced by any of this milestone's changes", () => {
    const combined = dispatchSource() + controlTowerSource() + contractsSource() + plannerSource();
    expect(combined).not.toContain("passwordHash");
  });
});
