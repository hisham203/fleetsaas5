import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, customerLocations, distanceBands, contracts, contractSiteScope, orders, invoices, invoiceLineItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task K.2 — Customer Site Editing & Metadata Maintenance. Isolated
// fixtures throughout (own customer/site per test), the lesson directly
// carried over from every prior Contract Management task's own
// cross-test-file interference on the real seeded Riyadh tenant.
async function setupSite(overrides: Partial<typeof customerLocations.$inferInsert> = {}) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  const customerId = genId();
  await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: `K2 Test Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
  const locationId = genId();
  await db.insert(customerLocations).values({ id: locationId, customerId, label: "Original Site", address: "Original Address", cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30", lat: 24.7, lng: 46.7, ...overrides });
  const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
  return { tenantId: tenant!.id, customerId, locationId, adminCookie };
}

describe("PATCH /api/customers/[id]/locations/[locationId] (Task K.2)", () => {
  it("1/2/3. an admin can update address and coordinates", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { address: "New Address", lat: 25.1, lng: 47.2 } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe("New Address");
    expect(body.lat).toBeCloseTo(25.1, 3);
    expect(body.lng).toBeCloseTo(47.2, 3);
    expect(body.label).toBe("Original Site"); // untouched
  });

  it("4/5. an admin can update cityCode and zoneCode independently", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED", zoneCode: "SOUTH" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cityCode).toBe("JED");
    expect(body.zoneCode).toBe("SOUTH");
    expect(body.distanceBandCode).toBe("RIYADH_NEAR_15_30"); // untouched
  });

  it("6. an admin can update distanceBandCode to a real, active tenant band", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { distanceBandCode: "RIYADH_FAR_50_PLUS" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distanceBandCode).toBe("RIYADH_FAR_50_PLUS");
  });

  it("7. an unknown distance band is rejected", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { distanceBandCode: "DOES_NOT_EXIST" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(422);
  });

  it("8. a retired distance band is rejected for new assignment", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    const retiredCode = `K2_RETIRED_${genId().slice(0, 8)}`;
    await db.insert(distanceBands).values({ id: genId(), tenantId, code: retiredCode, label: "Retired", fromKm: 0, toKm: 5, isActive: false, retiredAt: new Date() });
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { distanceBandCode: retiredCode } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("retired");
  });

  it("distanceBandCode can be cleared to null (schema allows it, no active-band check applies)", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { distanceBandCode: null } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distanceBandCode).toBeNull();
  });

  it("9. cross-tenant update is rejected", async () => {
    const { customerId, locationId } = await setupSite();
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: demoWaterCookie, body: { address: "Should Fail" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(401);
  });

  it("10. cross-customer update (real locationId, wrong customerId in the URL) is rejected", async () => {
    const site1 = await setupSite();
    const site2 = await setupSite();
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    // site1's own locationId, but site2's customerId in the URL — a
    // mismatched pair must never succeed, regardless of tenant.
    const res = await updateSite(
      makeRequest(`/api/customers/${site2.customerId}/locations/${site1.locationId}`, { method: "PATCH", cookie: site1.adminCookie, body: { address: "Should Fail" } }),
      { params: { id: site2.customerId, locationId: site1.locationId } }
    );
    expect(res.status).toBe(404);
  });

  it("11. a partial update does not overwrite fields that weren't supplied", async () => {
    const { customerId, locationId, adminCookie } = await setupSite({ label: "Keep Me", contactName: "Keep Contact" } as any);
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { address: "Only address changes" } }),
      { params: { id: customerId, locationId } }
    );
    const body = await res.json();
    expect(body.address).toBe("Only address changes");
    expect(body.label).toBe("Keep Me");
    expect(body.contactName).toBe("Keep Contact");
  });

  it("12. editing a site never modifies contract_site_scope", async () => {
    const { customerId, locationId, adminCookie } = await setupSite();
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", appliesToAllSites: false, startDate: "2026-01-01" },
    }))).json();
    const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
    await assignSites(makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: adminCookie, body: { customerLocationIds: [locationId] } }), { params: { id: contract.id } });

    const scopeBefore = await db.query.contractSiteScope.findMany({ where: eq(contractSiteScope.contractId, contract.id) });

    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );

    const scopeAfter = await db.query.contractSiteScope.findMany({ where: eq(contractSiteScope.contractId, contract.id) });
    expect(scopeAfter.length).toBe(scopeBefore.length);
    expect(scopeAfter.map((s) => s.customerLocationId)).toEqual(scopeBefore.map((s) => s.customerLocationId));
  });

  it("17. no passwordHash exposure in the PATCH response", async () => {
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

describe("Historical pricing safety guard (Task K.2, Part 3)", () => {
  it("blocks editing city/zone/distance band when a delivered-but-unbilled order references this site", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    const orderId = genId();
    await db.insert(orders).values({
      id: orderId, tenantId, orderNumber: `ORD-K2-${genId().slice(0, 6)}`, customerId, locationId,
      qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Test", lat: 24.7, lng: 46.7,
      requestedTime: new Date(), status: "DELIVERED", paymentMethod: "CASH", completedAt: new Date(),
    });

    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("not yet invoiced");
  });

  it("allows editing city/zone/distance band once that same order has been invoiced (its pricing is already frozen)", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    const orderId = genId();
    await db.insert(orders).values({
      id: orderId, tenantId, orderNumber: `ORD-K2-${genId().slice(0, 6)}`, customerId, locationId,
      qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Test", lat: 24.7, lng: 46.7,
      requestedTime: new Date(), status: "DELIVERED", paymentMethod: "CASH", completedAt: new Date(),
    });
    const invoiceId = genId();
    await db.insert(invoices).values({ id: invoiceId, tenantId, invoiceNumber: `INV-K2-${genId().slice(0, 6)}`, orderId, customerId, subtotal: 400, vatRate: 0.15, vatAmount: 60, total: 460, status: "PENDING" });

    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200); // this order's direct invoice already froze its price — safe to edit now
  });

  it("does not block editing non-pricing fields (address, coordinates) even with a delivered-but-unbilled order present", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    await db.insert(orders).values({
      id: genId(), tenantId, orderNumber: `ORD-K2-${genId().slice(0, 6)}`, customerId, locationId,
      qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Test", lat: 24.7, lng: 46.7,
      requestedTime: new Date(), status: "DELIVERED", paymentMethod: "CASH", completedAt: new Date(),
    });
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { address: "Updated safely" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200);
  });

  it("allows editing pricing fields when the only orders on this site are still PENDING (not yet delivered)", async () => {
    const { tenantId, customerId, locationId, adminCookie } = await setupSite();
    await db.insert(orders).values({
      id: genId(), tenantId, orderNumber: `ORD-K2-${genId().slice(0, 6)}`, customerId, locationId,
      qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Test", lat: 24.7, lng: 46.7,
      requestedTime: new Date(), status: "PENDING", paymentMethod: "CASH",
    });
    const { PATCH: updateSite } = await import("@/app/api/customers/[id]/locations/[locationId]/route");
    const res = await updateSite(
      makeRequest(`/api/customers/${customerId}/locations/${locationId}`, { method: "PATCH", cookie: adminCookie, body: { cityCode: "JED" } }),
      { params: { id: customerId, locationId } }
    );
    expect(res.status).toBe(200); // a not-yet-delivered order carries no frozen or at-risk pricing yet
  });
});

describe("Customer & Site UI editing (Task K.2)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");

  it("13. site editing UI exists", () => {
    expect(moduleSource).toContain("startEdit");
    expect(moduleSource).toContain("saveEdit");
    expect(moduleSource).toContain(">Edit<");
  });

  it("14. edit form prefills current values from the selected site", () => {
    expect(moduleSource).toMatch(/setEditLabel\(site\.label/);
    expect(moduleSource).toMatch(/setEditAddress\(site\.address/);
    expect(moduleSource).toMatch(/setEditCityCode\(site\.cityCode/);
  });

  it("15. the exact contract-use warning text exists for pricing-related edits", () => {
    expect(moduleSource).toContain("This site is used by active contracts. Changes to city/zone/distance band may affect future pricing eligibility.");
  });

  it("a retired currently-assigned band stays visible in the edit dropdown but isn't offered as a new choice elsewhere", () => {
    expect(moduleSource).toContain("retired — currently assigned");
  });

  it("16. site readiness refresh happens via the same load() call after a successful edit, no full page reload", () => {
    const saveEditBlock = moduleSource.slice(moduleSource.indexOf("async function saveEdit"), moduleSource.indexOf("async function saveEdit") + 1700);
    expect(saveEditBlock).toContain("load()");
    expect(saveEditBlock).not.toContain("window.location");
  });
});
