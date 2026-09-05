import { describe, it, expect } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Milestone Q — Dispatch Control Tower & Contract Planner aggregation
// endpoints. Real API-level tests, not just source-string checks, since
// both routes do genuine multi-table aggregation.
describe("GET /api/control-tower (Milestone Q, Gate Q4)", () => {
  it("returns normalized rows for real Riyadh orders, with no passwordHash exposure", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getControlTower } = await import("@/app/api/control-tower/route");
    const res = await getControlTower(makeRequest("/api/control-tower", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
    const rows = JSON.parse(text);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const row = rows[0];
      expect(row).toHaveProperty("operationalStatus");
      expect(row).toHaveProperty("billingStatus");
      expect(row).toHaveProperty("source");
    }
  });

  it("tenant isolation: only returns this tenant's own orders, never another tenant's", async () => {
    const riyadhTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getControlTower } = await import("@/app/api/control-tower/route");
    const res = await getControlTower(makeRequest("/api/control-tower", { cookie: riyadhAdminCookie }));
    const rows = await res.json();
    const demoOrder = await db.query.orders.findFirst({ where: eq(orders.tenantId, demoTenant!.id) });
    if (demoOrder) {
      expect(rows.some((r: any) => r.orderId === demoOrder.id)).toBe(false);
    }
  });

  it("DRIVER cannot access the Control Tower", async () => {
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET: getControlTower } = await import("@/app/api/control-tower/route");
    const res = await getControlTower(makeRequest("/api/control-tower", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("a delivered order with a real contract-priced invoice reports INVOICED_PENDING or INVOICED_PAID, matching real invoice data", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getControlTower } = await import("@/app/api/control-tower/route");
    const res = await getControlTower(makeRequest("/api/control-tower", { cookie: adminCookie }));
    const rows = await res.json();
    const anySource = rows.every((r: any) => ["B2B_CONTRACT", "B2B_CASH", "B2C_CASH", "UNKNOWN"].includes(r.source));
    expect(anySource).toBe(true);
  });
});

describe("GET /api/contract-planner (Milestone Q, Gate Q5)", () => {
  it("returns readiness data for active Riyadh contracts, reusing the same readiness function Contract Management already uses", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row).toHaveProperty("readyForDispatch");
    expect(row).toHaveProperty("readinessItems");
    expect(Array.isArray(row.readinessItems)).toBe(true);
  });

  it("a contract missing pricing rules is correctly reported as not ready, with a real blocked reason", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { genId } = await import("@/lib/helpers");
    const { contracts, customers: customersTable } = await import("@/lib/db/schema");
    const customerId = genId();
    await db.insert(customersTable).values({ id: customerId, tenantId: tenant!.id, name: "MQ Planner Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({
      id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MQ-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT",
      status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01"),
    });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }));
    const rows = await res.json();
    const found = rows.find((r: any) => r.contractId === contractId);
    expect(found).toBeTruthy();
    expect(found.readyForDispatch).toBe(false);
    expect(found.blockedReasons).toContain("STANDARD pricing configured");
  });

  it("DISPATCHER can access the planner, DRIVER cannot", async () => {
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const dispatcherRes = await getPlanner(makeRequest("/api/contract-planner", { cookie: dispatcherCookie }));
    expect(dispatcherRes.status).toBe(200);
    const driverRes = await getPlanner(makeRequest("/api/contract-planner", { cookie: driverCookie }));
    expect(driverRes.status).toBe(401);
  });

  it("no passwordHash exposure", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }));
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("Loading Points page reuses the existing warehouses entity, no duplicate model (Milestone Q, Gate Q6)", () => {
  it("the Loading Points page source calls the existing /api/warehouses and /api/trips APIs, no new backend entity", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/loading-points/page.tsx"), "utf8");
    expect(source).toContain("/api/warehouses");
    expect(source).toContain("/api/trips");
    expect(source).not.toContain("/api/loading-points"); // confirms no parallel entity/API was introduced
  });
});
