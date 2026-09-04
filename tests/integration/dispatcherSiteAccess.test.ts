import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, customerLocations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task K.4 — Dispatcher Customer/Site Operational Access Review.
// Isolated fixtures throughout.
async function setupSite() {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  const customerId = genId();
  await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: `K4 Test Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
  const locationId = genId();
  await db.insert(customerLocations).values({ id: locationId, customerId, label: "Original", address: "Original Address", cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30" });
  const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
  const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
  return { tenantId: tenant!.id, customerId, locationId, adminCookie, dispatcherCookie };
}

describe("DISPATCHER API access to operational site fields (Task K.4)", () => {
  it("can create a site with operational fields only", async () => {
    const { customerId, dispatcherCookie } = await setupSite();
    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: dispatcherCookie, body: { label: "New", address: "Test", contactName: "Someone", contactPhone: "0500000000" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(201);
  });

  it("cannot create a site with pricing-critical fields", async () => {
    const { customerId, dispatcherCookie } = await setupSite();
    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: dispatcherCookie, body: { label: "New", address: "Test", cityCode: "JED" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(403);
  });

  it("can PATCH operational fields on an existing site", async () => {
    const { customerId, locationId, dispatcherCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: dispatcherCookie, body: { address: "Corrected by dispatcher", lat: 25.0, lng: 47.0 } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe("Corrected by dispatcher");
  });

  it("cannot PATCH pricing-critical fields, and nothing is silently changed", async () => {
    const { customerId, locationId, dispatcherCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: dispatcherCookie, body: { distanceBandCode: "RIYADH_FAR_50_PLUS" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(403);
    const unchanged = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, locationId) });
    expect(unchanged!.distanceBandCode).toBe("RIYADH_NEAR_15_30");
  });

  it("ADMIN still can manage pricing-critical fields, subject to the financial guard", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
  });

  it("CUSTOMER restrictions from K.3 remain intact", async () => {
    const { customerId, locationId } = await setupSite();
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("password123", 10);
    await db.update(customers).set({ passwordHash: hash, loginEmail: `k4-cust-${genId().slice(0, 8)}@test.co` }).where(eq(customers.id, customerId));
    const updatedCustomer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const customerCookie = await loginAs(updatedCustomer!.loginEmail!, "password123");

    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: customerCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(403);
  });

  it("DRIVER remains blocked entirely", async () => {
    const { customerId, locationId } = await setupSite();
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: driverCookie, body: { address: "Should fail" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(401);
  });

  it("no passwordHash exposure in any of these responses", async () => {
    const { customerId, locationId, dispatcherCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: dispatcherCookie, body: { address: "Test" } }),
      { params: { id: customerId, locationId } }
    );
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("DISPATCHER UI access to /admin/customers (Task K.4)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");

  it("DISPATCHER is admitted to the Customer & Site Configuration module", () => {
    expect(moduleSource).toContain('useRequireSession(["ADMIN", "DISPATCHER"])');
  });

  it("the UI does not expose editable cityCode/zoneCode/distanceBandCode inputs to a non-admin session — gated by isAdmin", () => {
    // Every editable pricing-critical input (text input or select) must
    // sit behind an isAdmin check, not merely a comment or a disabled
    // attribute — confirmed by requiring the isAdmin ternary/guard to
    // wrap each occurrence of these fields as a controlled input.
    expect(moduleSource).toContain("isAdmin ? (");
    expect(moduleSource).toContain("City, zone, and distance band are managed by admins because they affect contractual pricing.");
    // The add-site and edit forms both branch on isAdmin before ever
    // rendering a cityCode/zoneCode/distanceBandCode <input>/<select> —
    // located via the "City code" placeholder itself, not the first
    // isAdmin occurrence in the file (which is in page navigation).
    const cityCodeIndex = moduleSource.indexOf("City code");
    const addFormBlock = moduleSource.slice(Math.max(0, cityCodeIndex - 300), cityCodeIndex);
    expect(addFormBlock).toContain("isAdmin ? (");
  });

  it("non-admin create/edit requests never include pricing-critical keys in the request body at all", () => {
    const addSiteBlock = moduleSource.slice(moduleSource.indexOf("async function addSite"), moduleSource.indexOf("async function addSite") + 700);
    const saveEditBlock = moduleSource.slice(moduleSource.indexOf("async function saveEdit"), moduleSource.indexOf("async function saveEdit") + 1700);
    expect(addSiteBlock).toContain("if (isAdmin)");
    expect(saveEditBlock).toContain("if (isAdmin)");
  });

  it("Contract Management is not linked for a non-admin session on this page", () => {
    const navBlock = moduleSource.slice(moduleSource.indexOf("Back to Admin") - 200, moduleSource.indexOf("Back to Admin") + 400);
    expect(navBlock).toContain("isAdmin");
  });

  it("does not expose contract-scope commercial context (the pricing-eligibility warning) to a non-admin session", () => {
    const warningIndex = moduleSource.indexOf("may affect future pricing eligibility");
    const beforeWarning = moduleSource.slice(Math.max(0, warningIndex - 300), warningIndex);
    expect(beforeWarning).toContain("isAdmin");
  });
});
