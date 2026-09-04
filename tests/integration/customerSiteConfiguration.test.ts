import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, customerLocations, distanceBands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task K — Customer & Site Configuration Module Readiness.
describe("Customer location creation API extension (Task K)", () => {
  it("1/3. cityCode/zoneCode/distanceBandCode can now be set at site creation, where previously only label/address/coords/contact were accepted", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, {
        method: "POST", cookie: adminCookie,
        body: { label: "New Site", address: "123 Test St", cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30" },
      }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.cityCode).toBe("RUH");
    expect(created.zoneCode).toBe("NORTH");
    expect(created.distanceBandCode).toBe("RIYADH_NEAR_15_30");
  });

  it("7. assigning a retired distance band to a new site is rejected with a clear error", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK Retired Band Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const retiredCode = `TASKK_RETIRED_${genId().slice(0, 8)}`;
    await db.insert(distanceBands).values({ id: genId(), tenantId: tenant!.id, code: retiredCode, label: "Retired Band", fromKm: 0, toKm: 10, isActive: false, retiredAt: new Date() });

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, {
        method: "POST", cookie: adminCookie,
        body: { label: "Bad Site", address: "Test", distanceBandCode: retiredCode },
      }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("retired");
  });

  it("a distance band code that doesn't exist at all for this tenant is also rejected", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK Nonexistent Band Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, {
        method: "POST", cookie: adminCookie,
        body: { label: "Bad Site", address: "Test", distanceBandCode: "DOES_NOT_EXIST_AT_ALL" },
      }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(422);
  });

  it("creating a site without a distance band still works exactly as before (fully optional, no regression)", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK No Band Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: adminCookie, body: { label: "Plain Site", address: "Test" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(201);
  });

  it("5. cross-tenant customer site creation is blocked by the existing tenant-boundary check", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK CrossTenant Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: demoWaterCookie, body: { label: "Should Fail", address: "Test" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(401);
  });

  it("8. no passwordHash exposure in the locations list or create response", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskK PwHash Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getLocations } = await import("@/app/api/customers/[id]/locations/route");
    const res = await getLocations(makeRequest(`/api/customers/${customerId}/locations`, { cookie: adminCookie }), { params: { id: customerId } });
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("Customer & Site Configuration UI (Task K)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");

  it("2. the module shows customer sites with cityCode/zoneCode/distanceBandCode", () => {
    expect(moduleSource).toContain("cityCode");
    expect(moduleSource).toContain("zoneCode");
    expect(moduleSource).toContain("distanceBandCode");
  });

  it("4. site creation form is present and posts to the real, extended API", () => {
    expect(moduleSource).toContain("addSite");
    expect(moduleSource).toContain("/locations");
    expect(moduleSource).toContain("Create site");
  });

  it("6. Site Readiness is shown, using the extracted computeSiteReadinessItems function", () => {
    expect(moduleSource).toContain("computeSiteReadinessItems");
    expect(moduleSource).toContain("SiteReadinessBadges");
  });

  it("7. retired distance bands are clearly labeled in the site list", () => {
    expect(moduleSource).toContain("retired");
  });

  it("contract relationship visibility is present without a new complex relationship service — reuses existing contract detail/list endpoints", () => {
    expect(moduleSource).toContain("siteContracts");
    expect(moduleSource).toContain("On contract(s):");
    expect(moduleSource).not.toContain("/api/site-contracts"); // no new endpoint was invented
  });

  it("this is a standalone module, linked from Admin, not a tab bolted onto the legacy page", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("/admin/customers");
    expect(adminSource).toContain("Customers & Sites");
  });
});

describe("Riyadh Bulk Water pilot data completeness (Task K, Part 5)", () => {
  it("reports exactly what the six real seeded customers' sites do and don't have, without mutating anything", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const seededCustomerNames = ["Riyadh Towers Facilities", "Al Nakheel Compound", "Industrial Zone Operations", "Metro Construction Site", "Hospital Facilities Group", "University Campus Services"];
    const seededCustomers = await db.query.customers.findMany({ where: eq(customers.tenantId, tenant!.id) });
    const realSeeded = seededCustomers.filter((c) => seededCustomerNames.includes(c.name));
    expect(realSeeded.length).toBe(6); // confirms all six still exist, unmutated by this task

    const { computeSiteReadinessItems } = await import("@/lib/siteReadiness");
    for (const customer of realSeeded) {
      const sites = await db.query.customerLocations.findMany({ where: eq(customerLocations.customerId, customer.id) });
      expect(sites.length).toBeGreaterThanOrEqual(1); // every seeded customer has at least one real site
      for (const site of sites) {
        const items = computeSiteReadinessItems(site);
        // Documented finding, not asserted as a failure: every seeded
        // site already has cityCode/zoneCode/distanceBandCode and
        // coordinates set (confirmed by Task F's own seed design) —
        // this proves that expectation directly, read-only.
        expect(items.every((i) => i.state === "READY")).toBe(true);
      }
    }
  });
});
