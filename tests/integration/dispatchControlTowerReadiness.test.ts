import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses, customers, inventoryItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task N — Dispatch Control Tower Readiness Review.
describe("Dispatch page source-level improvements (Task N)", () => {
  const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");

  it("1/2. selected-order summary shows customer/site/contract with neutral wording, no bottle-era language", () => {
    expect(dispatchSource).toContain("o.customer.name");
    expect(dispatchSource).toContain("o.location?.label");
    expect(dispatchSource).toContain("o.contract");
    expect(dispatchSource).not.toContain("bottleSizeLtr");
  });

  it("3. vehicle readiness includes capacityLiters when present, with a units fallback", () => {
    expect(dispatchSource).toContain("capacityLiters");
    expect(dispatchSource).toContain("capacityUnits");
  });

  it("4. the loading point zero-inventory note uses the exact specified wording, shown only when genuinely no inventory is tracked there", () => {
    expect(dispatchSource).toContain("No tracked inventory. Loading confirmation will not require stock deduction.");
    expect(dispatchSource).toContain("!inventory.some((i) => i.warehouseId === warehouseId)");
  });

  it("5/6. dispatchTrip, resolveStop, confirmLoading, and completeTrip all surface real API errors and always reset their busy state via finally", () => {
    for (const fnName of ["dispatchTrip", "confirmLoading", "completeTrip", "resolveStop"]) {
      const start = dispatchSource.indexOf(`async function ${fnName}`);
      expect(start, `expected to find function ${fnName}`).toBeGreaterThan(-1);
      const fnBody = dispatchSource.slice(start, start + 1200);
      expect(fnBody).toContain("finally");
      expect(fnBody).toContain('typeof data.error === "string"');
    }
  });

  it("7. the duplicate-assignment guard message path exists (queue filters to PENDING/VALIDATED only, refreshed by load())", () => {
    expect(dispatchSource).toContain('o.status === "PENDING" || o.status === "VALIDATED"');
  });
});

describe("Loading confirmation regression checks (Task N, Parts 4/6)", () => {
  it("8. loading confirmation still succeeds for a zero-inventory Riyadh loading point", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "n-loading-reconfirm");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie, body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }))).json();
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: adminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    expect(res.status).toBe(200);
  });

  it("9. legacy inventory shortage still blocks loading confirmation for Demo Water Co.", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");
    const mainWarehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, tenant!.id), eq(warehouses.isDefault, true)) });
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "n-shortage-reconfirm");

    // Deliberately request more bottles than are in stock.
    const stock = await db.query.inventoryItems.findFirst({ where: and(eq(inventoryItems.warehouseId, mainWarehouse!.id), eq(inventoryItems.itemName, "19L Bottle - Full")) });
    const excessiveQty = (stock?.quantity ?? 0) + 100000;

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie, body: { customerId: customer!.id, qtyOrdered: excessiveQty, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }))).json();
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const tripRes = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: adminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: mainWarehouse!.id, orderIds: [order.id] },
    }));
    // Either capacity or loading-stock validation should reject this —
    // either way, it must not silently succeed.
    if (tripRes.status !== 201) {
      expect(tripRes.status).toBe(422);
      return;
    }
    const trip = await tripRes.json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("19L Bottle - Full");
  });
});

describe("Driver/dispatch consistency (Task N, Part 5)", () => {
  it("10. driver page messaging for a PLANNED trip remains consistent with dispatch's own lifecycle labels", () => {
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    expect(driverSource).toContain("awaiting dispatch");
    expect(driverSource).toContain("awaiting loading confirmation by dispatcher");
  });
});

describe("Security (Task N)", () => {
  it("11. no passwordHash exposure from the dispatch page's new inventory fetch", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getInventory } = await import("@/app/api/inventory/route");
    const res = await getInventory(makeRequest("/api/inventory", { cookie: adminCookie }));
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});
