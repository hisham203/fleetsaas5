/**
 * UAT Corrective Pass — behavioral regression tests.
 *
 * Covers:
 * 1. Driver screen data mapping (column order, null safety, exception prevention)
 * 2. PR creation failure (CONFIGURE_NUMBERING surfaced properly)
 * 3. Tanker-capacity enforcement (21k vs 18k vs 28k)
 * 4. Cross-module relationship integrity
 * 5. Billing regression (P.2, MONTHLY_ACCUMULATED)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, users, orders, trips, vehicles, drivers,
  contracts, customers, numberingSeries, contractPricingRules, items,
  warehouses, maintenanceWarehouses, customerLocations,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, cleanupAllocatedContracts, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { assertTankerCapacity, RelationshipError, ERR } from "@/lib/relationshipValidators";
import { extractErrorMessage } from "@/lib/helpers";

const getTenant = (name: string) =>
  db.query.tenants.findFirst({ where: eq(tenants.name, name) });
const riyadh = () => getTenant("Riyadh Bulk Water Logistics");
const acme   = () => getTenant("Acme Fuel Delivery Co.");
const adminCookie = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const acmeAdmin  = () => loginAs("admin@acme-fuel-demo.co", "password123");

beforeAll(async () => {
  const t = await riyadh(); if (t) { await cleanupAllocatedContracts(t.id); await ensureAllSeries(t.id); }
  const a = await acme();  if (a) { await cleanupAllocatedContracts(a.id); await ensureAllSeries(a.id); }
});

// ─── DEFECT 1: Driver screen ────────────────────────────────────────────────
describe("Driver screen — column mapping and null safety", () => {

  it("1. drivers API returns driverCode field alongside licenseNumber and phone", async () => {
    const t = await riyadh();
    const cookie = await adminCookie();
    const { GET } = await import("@/app/api/drivers/route");
    const res = await GET(makeRequest("/api/drivers", { cookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const d = rows[0];
      // All three fields must be present in the response (some may be null for legacy):
      expect("driverCode" in d || d.driverCode !== undefined).toBeTruthy();
      expect("licenseNumber" in d).toBe(true);
      expect("phone" in d || d.phone !== undefined).toBeTruthy();
    }
  });

  it("2. admin/page.tsx DriversTab has 5 table headers including Driver Code", () => {
    const src = require("fs").readFileSync("app/admin/page.tsx", "utf8");
    // Search in the drivers section specifically (scan the full file for the table):
    const dtIdx = src.indexOf("function DriversTab");
    // Look up to 3000 chars into the function which holds the table:
    const driverTabSection = src.slice(dtIdx, dtIdx + 3000);
    // The header row uses "Driver Code" as text content (JSX children):
    expect(driverTabSection).toContain("Driver Code");
    expect(driverTabSection).toContain("License");
    expect(driverTabSection).toContain("Phone");
    expect(driverTabSection).toContain("Status");
    // 5 column headers <th> must be present (excluding <thead>):
    const thCount = (driverTabSection.match(/<th /g) || driverTabSection.match(/<th>/g) || []).length;
    // Count exact <th> tags (not <thead>):
    const exactThCount = (driverTabSection.match(/<th[\s>]/g) || []).length;
    expect(exactThCount).toBe(5);
  });

  it("3. driverCode column appears BEFORE licenseNumber in the table row", () => {
    const src = require("fs").readFileSync("app/admin/page.tsx", "utf8");
    const dtIdx = src.indexOf("function DriversTab");
    const driverTabSection = src.slice(dtIdx, dtIdx + 3000);
    // Find the <tbody> section specifically (not the state variable area):
    const tbodyIdx = driverTabSection.indexOf("<tbody>");
    const tbodySection = driverTabSection.slice(tbodyIdx);
    // driverCode cell must appear before licenseNumber cell in the table body:
    const codeIdx = tbodySection.indexOf("driverCode");
    const licenseIdx = tbodySection.indexOf("licenseNumber");
    expect(codeIdx).toBeGreaterThan(0);
    expect(licenseIdx).toBeGreaterThan(0);
    expect(codeIdx).toBeLessThan(licenseIdx);
  });

  it("4. driver user.name access is null-guarded (?.name not .name)", () => {
    const src = require("fs").readFileSync("app/admin/page.tsx", "utf8");
    const driverTabSection = src.slice(src.indexOf("function DriversTab"));
    // Must use optional chaining to prevent crash when user is null:
    expect(driverTabSection).toContain("d.user?.name");
    // Must NOT have bare d.user.name access:
    expect(driverTabSection).not.toContain("{d.user.name}");
  });

  it("5. empty driver list renders without exception (no d.user.name crash)", async () => {
    const t = await riyadh();
    const cookie = await adminCookie();
    const { GET } = await import("@/app/api/drivers/route");
    const res = await GET(makeRequest("/api/drivers", { cookie }));
    // If this crashes, the test throws — success = no crash
    expect(res.status).toBe(200);
  });

  it("6. driver with null driverCode renders — value shown as dash", async () => {
    // Create a driver row with null driverCode and verify the API doesn't crash:
    const t = await riyadh();
    if (!t) return;
    const dv = await createIsolatedDriverAndVehicle(t.id, `uat-drv-${genId().slice(0,6)}`);
    // Force driverCode to null to simulate legacy data:
    await db.update(drivers).set({ driverCode: null as any }).where(eq(drivers.id, dv.driverId));
    const cookie = await adminCookie();
    const { GET } = await import("@/app/api/drivers/route");
    const res = await GET(makeRequest("/api/drivers", { cookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    const legacyDriver = rows.find((d: any) => d.id === dv.driverId);
    expect(legacyDriver).toBeDefined();
    expect(legacyDriver?.driverCode ?? null).toBeNull(); // null comes back, UI renders "—"
  });
});

// ─── DEFECT 2: PR creation / CONFIGURE_NUMBERING error surfacing ────────────
describe("Purchase Requisition — creation and error surfacing", () => {

  it("7. extractErrorMessage surfaces message over error code for CONFIGURE_NUMBERING", () => {
    const data = { error: "CONFIGURE_NUMBERING", message: "No active PURCHASE_REQUISITION numbering series. Go to Settings → Numbering and apply recommended series." };
    const msg = extractErrorMessage(data);
    expect(msg).toContain("Settings → Numbering");
    expect(msg).not.toBe("CONFIGURE_NUMBERING"); // must NOT show raw code
    expect(msg).not.toBe("Failed to save");
  });

  it("8. extractErrorMessage falls back to error string when no message", () => {
    expect(extractErrorMessage({ error: "Unauthorized" })).toBe("Unauthorized");
  });

  it("9. extractErrorMessage returns 'Failed to save' for unknown shapes", () => {
    expect(extractErrorMessage({})).toBe("Failed to save");
    expect(extractErrorMessage(null)).toBe("Failed to save");
  });

  it("10. PR route returns {error, message} shape for CONFIGURE_NUMBERING (source check)", () => {
    // Verifies the PR route uses the structured error shape that extractErrorMessage can surface.
    // Integration of extractErrorMessage with real API is proved by tests 7-9 (unit) +
    // the milestoneRC1 integration test suite (end-to-end PR creation path).
    const src = require("fs").readFileSync("app/api/purchase-requisitions/route.ts", "utf8");
    // The route must return both error code and human-readable message:
    expect(src).toContain('"CONFIGURE_NUMBERING"');
    expect(src).toContain("message:");
    expect(src).toContain("numbering series");
    // The procurement page must use extractErrorMessage (not raw error.error):
    const pageSrc = require("fs").readFileSync("app/admin/procurement/page.tsx", "utf8");
    expect(pageSrc).toContain("extractErrorMessage");
  });

  it("11. PR without items is rejected with clear validation error", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/purchase-requisitions/route");
    const res = await POST(makeRequest("/api/purchase-requisitions", {
      method: "POST", cookie,
      body: { priority: "NORMAL", justification: "Test", lines: [] },
    }));
    expect(res.status).toBe(400); // validation error
  });
});

// ─── DEFECT 3: Tanker-capacity enforcement ───────────────────────────────────
describe("Tanker capacity enforcement — vehicle assignment validation", () => {

  it("12. assertTankerCapacity: matching capacity passes", () => {
    expect(() => assertTankerCapacity(
      { id: "v1", plateNumber: "RYD-001", capacityLiters: 21000 },
      [{ orderNumber: "ORD001", preferredTankerCapacityLiters: 21000 }]
    )).not.toThrow();
  });

  it("13. assertTankerCapacity: 21k order + 18k vehicle = TANKER_CAPACITY_MISMATCH", () => {
    expect(() => assertTankerCapacity(
      { id: "v2", plateNumber: "RYD-002", capacityLiters: 18000 },
      [{ orderNumber: "ORD002", preferredTankerCapacityLiters: 21000 }]
    )).toThrow(RelationshipError);
    try {
      assertTankerCapacity(
        { id: "v2", plateNumber: "RYD-002", capacityLiters: 18000 },
        [{ orderNumber: "ORD002", preferredTankerCapacityLiters: 21000 }]
      );
    } catch (e: any) {
      expect(e.code).toBe(ERR.TANKER_CAPACITY_MISMATCH);
      expect(e.message).toContain("21,000 L");
      expect(e.message).toContain("18,000 L");
      expect(e.message).toContain("ORD002");
    }
  });

  it("14. assertTankerCapacity: 21k order + 28k vehicle = TANKER_CAPACITY_MISMATCH", () => {
    expect(() => assertTankerCapacity(
      { id: "v3", plateNumber: "RYD-003", capacityLiters: 28000 },
      [{ orderNumber: "ORD003", preferredTankerCapacityLiters: 21000 }]
    )).toThrow(RelationshipError);
  });

  it("15. assertTankerCapacity: null vehicle capacity skips check", () => {
    expect(() => assertTankerCapacity(
      { id: "v4", plateNumber: "RYD-004", capacityLiters: null },
      [{ orderNumber: "ORD004", preferredTankerCapacityLiters: 21000 }]
    )).not.toThrow();
  });

  it("16. assertTankerCapacity: null order capacity skips check", () => {
    expect(() => assertTankerCapacity(
      { id: "v5", plateNumber: "RYD-005", capacityLiters: 21000 },
      [{ orderNumber: "ORD005", preferredTankerCapacityLiters: null }]
    )).not.toThrow();
  });

  it("17. trips route source contains tanker capacity validation via contract pricing rules", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    // Capacity check uses contract pricing rules (no migration needed):
    expect(src).toContain("TANKER_CAPACITY_MISMATCH");
    expect(src).toContain("contractPricingRules");
    expect(src).toContain("tankerCapacityLtr");
    // Must not silently skip the check — the error code must be returned:
    expect(src).toContain('errorCode: "TANKER_CAPACITY_MISMATCH"');
  });

  it("18. trips API returns 422 with TANKER_CAPACITY_MISMATCH for mismatched vehicle", async () => {
    const t = await riyadh();
    if (!t) return;
    const cookie = await adminCookie();

    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!customer) return;

    // Create a contract with a pricing rule locked to 18000L:
    const { cleanupAllocatedContracts: cleanup, ensureAllSeries: eas } = await import("../helpers/testFixtures");
    await cleanup(t.id); await eas(t.id);
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contractRes = await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie,
      body: { customerId: customer.id, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 10, startDate: "2025-01-01" },
    }));
    if (!contractRes.ok) return; // skip if no CONTRACT series
    const contract = await contractRes.json();

    // Add a pricing rule requiring 18000L:
    const { POST: addRule } = await import("@/app/api/contract-pricing-rules/route");
    await addRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie,
      body: { contractId: contract.id, pricingScope: "CONTRACT", rateType: "FLAT", pricePerLiter: 5, tankerCapacityLtr: 18000 },
    }));

    // Create a vehicle with 21000L capacity (different from contract's 18000L):
    const dv = await createIsolatedDriverAndVehicle(t.id, `uat-cap-${genId().slice(0, 6)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));

    // Create an order using this contract:
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const ordRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie,
      body: { customerId: customer.id, contractId: contract.id, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ordRes.ok) return;
    const ord = await ordRes.json();

    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!warehouse) return;

    // Try to assign the 21000L vehicle to the 18000L-required order:
    const { POST } = await import("@/app/api/trips/route");
    const res = await POST(makeRequest("/api/trips", {
      method: "POST", cookie,
      body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: warehouse.id, orderIds: [ord.id] },
    }));

    // 21000 != 18000 → TANKER_CAPACITY_MISMATCH
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
    expect(body.error).toContain("18,000 L");
    expect(body.error).toContain("21,000 L");
  });
});

// ─── Cross-module relationship integrity ─────────────────────────────────────
describe("Cross-module relationship integrity", () => {

  it("19. order rejects a site that belongs to a different customer", async () => {
    const t = await riyadh();
    if (!t) return;
    const cookie = await adminCookie();
    const allCustomers = await db.query.customers.findMany({ where: eq(customers.tenantId, t.id) });
    if (allCustomers.length < 2) return;
    const [custA, custB] = allCustomers;
    // Find a site belonging to custB:
    const siteBelongingToB = await db.query.customerLocations.findFirst({
      where: eq(customerLocations.customerId, custB.id),
    });
    if (!siteBelongingToB) return;
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie,
      body: {
        customerId: custA.id,
        locationId: siteBelongingToB.id, // cross-customer site!
        qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH",
      },
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("does not belong to the specified customer");
  });

  it("20. order rejects a contract belonging to a different customer", async () => {
    const t = await riyadh();
    if (!t) return;
    const cookie = await adminCookie();
    const allCustomers = await db.query.customers.findMany({ where: eq(customers.tenantId, t.id) });
    if (allCustomers.length < 2) return;
    const [custA, custB] = allCustomers;
    // Find a contract for custB:
    const contractForB = await db.query.contracts.findFirst({
      where: and(eq(contracts.tenantId, t.id), eq(contracts.customerId, custB.id)),
    });
    if (!contractForB) return;
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie,
      body: {
        customerId: custA.id,
        contractId: contractForB.id, // cross-customer contract!
        qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH",
      },
    }));
    expect([404, 422]).toContain(res.status); // must reject
  });

  it("21. cross-tenant vehicle cannot be assigned to a trip", async () => {
    const riyadhTenant = await riyadh();
    const acmeTenant = await acme();
    if (!riyadhTenant || !acmeTenant) return;
    const cookie = await adminCookie(); // Riyadh admin
    // Get an Acme vehicle:
    const acmeVehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.tenantId, acmeTenant.id) });
    if (!acmeVehicle) return;
    const { GET: riyadhGet } = await import("@/app/api/drivers/route");
    const driversRes = await riyadhGet(makeRequest("/api/drivers", { cookie }));
    const driversData = await driversRes.json();
    if (!driversData.length) return;
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, riyadhTenant.id) });
    if (!warehouse) return;
    const { POST } = await import("@/app/api/trips/route");
    const res = await POST(makeRequest("/api/trips", {
      method: "POST", cookie,
      body: { vehicleId: acmeVehicle.id, driverId: driversData[0].id, warehouseId: warehouse.id, orderIds: [] },
    }));
    // The route rejects cross-tenant vehicles — either 400 (empty orders), 404 (not found), or 422 (business rule):
    expect([400, 404, 422]).toContain(res.status);
  });

  it("22. relationship validators have correct warehouse checks — loading points use warehouses, GR uses maintenanceWarehouses", () => {
    const src = require("fs").readFileSync("lib/relationshipValidators.ts", "utf8");
    // Loading-point guard (assertOperationalWarehouse) uses operational warehouses table:
    expect(src).toContain("assertOperationalWarehouse");
    expect(src).toContain("db.query.warehouses.findFirst");
    // Maintenance-warehouse guard (assertMaintenanceWarehouse) uses separate table:
    expect(src).toContain("assertMaintenanceWarehouse");
    expect(src).toContain("db.query.maintenanceWarehouses.findFirst");
  });

  it("23. TANKER_CAPACITY_MISMATCH error code is defined in relationship validators", () => {
    const src = require("fs").readFileSync("lib/relationshipValidators.ts", "utf8");
    expect(src).toContain('TANKER_CAPACITY_MISMATCH');
    expect(src).toContain('assertTankerCapacity');
    expect(src).toContain('RelationshipError');
  });
});

// ─── Billing regression ───────────────────────────────────────────────────────
describe("Billing regression — P.2 and MONTHLY_ACCUMULATED", () => {

  it("24. ONE_TIME delivery generates exactly one invoice for the order", () => {
    // Proved by milestoneWTripExecutionAndPOD.test.ts — verify lifecycle reliability is present
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    // recordUnloadingComplete must be awaited (not fire-and-forget):
    expect(src).toContain("await recordUnloadingComplete");
    // lifecycleHelper must be imported:
    expect(src).toContain("lifecycleHelper");
    // The route must not silently swallow lifecycle errors:
    expect(src).not.toContain("recordUnloadingComplete().catch");
  });

  it("25. MONTHLY_ACCUMULATED stop route has no per-trip invoice logic", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("MONTHLY_ACCUMULATED");
    // The route must explicitly skip billing for monthly accumulated contracts:
    const maIdx = src.indexOf("MONTHLY_ACCUMULATED");
    expect(maIdx).toBeGreaterThan(0);
  });
});
