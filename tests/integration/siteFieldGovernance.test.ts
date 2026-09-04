import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, customerLocations, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task K.3 — Customer Site Access-Control & Pricing-Critical Field
// Governance. Isolated fixtures throughout.
async function setupSite() {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  const customerId = genId();
  await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: `K3 Test Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7, loginEmail: `k3-${genId().slice(0, 8)}@test.co`, passwordHash: "irrelevant-for-these-tests" });
  const locationId = genId();
  await db.insert(customerLocations).values({ id: locationId, customerId, label: "Original", address: "Original Address", cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30" });
  const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
  return { tenantId: tenant!.id, customerId, locationId, adminCookie };
}

describe("Field-level authorization on customer location creation (Task K.3)", () => {
  it("1. ADMIN can create a site with cityCode/zoneCode/distanceBandCode", async () => {
    const { customerId, adminCookie } = await setupSite();
    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: adminCookie, body: { label: "New", address: "Test", cityCode: "RUH", zoneCode: "N", distanceBandCode: "RIYADH_NEAR_15_30" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(201);
  });

  it("3. CUSTOMER cannot create a site with pricing-critical fields, rejected server-side even though the real UI never sends them", async () => {
    const { customerId } = await setupSite();
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    // Login as this exact test customer requires a real bcrypt hash; use
    // a real one via the existing seeded portal login pattern instead,
    // scoped to this same customer via direct db update for simplicity.
    const bcrypt = await import("bcryptjs");
    const realHash = await bcrypt.hash("password123", 10);
    await db.update(customers).set({ passwordHash: realHash }).where(eq(customers.id, customerId));
    const realCustomerCookie = await loginAs(customer!.loginEmail!, "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: realCustomerCookie, body: { label: "New", address: "Test", cityCode: "RUH" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(403);
  });

  it("CUSTOMER can still create a site with only operational fields (unchanged from before this task)", async () => {
    const { customerId } = await setupSite();
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const bcrypt = await import("bcryptjs");
    const realHash = await bcrypt.hash("password123", 10);
    await db.update(customers).set({ passwordHash: realHash }).where(eq(customers.id, customerId));
    const customerCookie = await loginAs(customer!.loginEmail!, "password123");

    const { POST: createLocation } = await import("@/app/api/customers/[id]/locations/route");
    const res = await createLocation(
      makeRequest(`/api/customers/${customerId}/locations`, { method: "POST", cookie: customerCookie, body: { label: "New", address: "Test", contactName: "Someone" } }),
      { params: { id: customerId } }
    );
    expect(res.status).toBe(201);
  });
});

describe("Field-level authorization on customer location editing (Task K.3)", () => {
  async function makeRealCustomerSession(customerId: string) {
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const bcrypt = await import("bcryptjs");
    const realHash = await bcrypt.hash("password123", 10);
    await db.update(customers).set({ passwordHash: realHash }).where(eq(customers.id, customerId));
    return loginAs(customer!.loginEmail!, "password123");
  }

  it("2. ADMIN can edit pricing-critical fields when the financial-safety guard allows it", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
  });

  it("4. CUSTOMER cannot PATCH pricing-critical fields on their own site", async () => {
    const { customerId, locationId } = await setupSite();
    const customerCookie = await makeRealCustomerSession(customerId);
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: customerCookie, body: { distanceBandCode: "RIYADH_FAR_50_PLUS" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(403);
    // Confirm nothing was silently changed either.
    const unchanged = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, locationId) });
    expect(unchanged!.distanceBandCode).toBe("RIYADH_NEAR_15_30");
  });

  it("5. CUSTOMER can edit permitted operational fields on their own site", async () => {
    const { customerId, locationId } = await setupSite();
    const customerCookie = await makeRealCustomerSession(customerId);
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: customerCookie, body: { address: "Updated by customer", contactPhone: "0500000000" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe("Updated by customer");
  });

  it("6. CUSTOMER cannot edit another customer's site", async () => {
    const siteA = await setupSite();
    const siteB = await setupSite();
    const customerACookie = await makeRealCustomerSession(siteA.customerId);
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${siteB.customerId}/locations/${siteB.locationId}`, { method: "PATCH", cookie: customerACookie, body: { address: "Should fail" } }),
      { params: { id: siteB.customerId, locationId: siteB.locationId } }
    );
    expect(res.status).toBe(401);
  });

  it("7. DRIVER cannot edit customer sites at all", async () => {
    const { customerId, locationId } = await setupSite();
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: driverCookie, body: { address: "Should fail" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(401);
  });

  it("8. DISPATCHER cannot change pricing-critical fields — governed as ADMIN-only per this task's decision", async () => {
    const { customerId, locationId } = await setupSite();
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: dispatcherCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(403);
  });

  it("9. DISPATCHER can still edit operational fields — unchanged from before this task", async () => {
    const { customerId, locationId } = await setupSite();
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: dispatcherCookie, body: { address: "Updated by dispatcher" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
  });

  it("10. the delivered-unbilled financial safety guard still blocks even ADMIN, regardless of role authorization", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    await db.insert(orders).values({
      id: genId(), tenantId, orderNumber: `ORD-K3-${genId().slice(0, 6)}`, customerId, locationId,
      qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Test", lat: 24.7, lng: 46.7,
      requestedTime: new Date(), status: "DELIVERED", paymentMethod: "CASH", completedAt: new Date(),
    });
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(422); // role authorization passed (ADMIN), but the financial guard still blocks it
  });

  it("12. cross-tenant PATCH attempts remain rejected, unaffected by the new field-level check", async () => {
    const { customerId, locationId } = await setupSite();
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: demoWaterCookie, body: { address: "Should fail" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(401);
  });

  it("13. no passwordHash exposure in any of these responses", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { address: "Test" } }),
      { params: { id: customerId, locationId } }
    );
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("B2B portal self-service UX (Task K.3, Part 5)", () => {
  it("the customer-facing add-location form still never sends pricing-critical fields, and now explains why", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/b2b/page.tsx"), "utf8");
    const addLocationBody = source.slice(source.indexOf("async function addLocation"), source.indexOf("async function addLocation") + 400);
    expect(addLocationBody).not.toContain("cityCode");
    expect(addLocationBody).not.toContain("zoneCode");
    expect(addLocationBody).not.toContain("distanceBandCode");
    expect(source).toContain("City, zone, and distance band are managed by the operator because they affect contractual pricing.");
  });
});
