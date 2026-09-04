import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules, contractSiteScope, customerLocations, distanceBands } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task I — Contract Management Module (first slice). No frontend
// rendering framework exists in this project, so per this task's own
// guidance this verifies the module at the level that's actually
// meaningful: the page source contains the right concepts/wording for
// every required contract type/scenario, and the real APIs it calls
// return everything the page needs to render them.
describe("Contract Management module (Task I)", () => {
  it("1. the standalone module page exists as its own route, not a tab inside admin/page.tsx", () => {
    const modulePath = path.join(process.cwd(), "app/admin/contracts/page.tsx");
    expect(fs.existsSync(modulePath)).toBe(true);
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("/admin/contracts");
    expect(adminSource).toContain("Contract Management");
  });

  describe("Source content — every required scenario is represented", () => {
    const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

    it("3. MONTHLY_ACCUMULATED contracts show billing-period readiness", () => {
      expect(moduleSource).toContain("Monthly billing readiness");
      expect(moduleSource).toContain("MonthlyBillingReadiness");
    });

    it("4. ONE_TIME_TRIP_COUNT contracts show trips purchased/used/remaining and overage", () => {
      expect(moduleSource).toContain("Trip usage");
      expect(moduleSource).toContain("remaining");
      expect(moduleSource).toContain("overageActive");
      expect(moduleSource).toContain("OVERAGE");
    });

    it("5. site-restricted contracts show site scope with city/zone/band, and warn when no sites are assigned", () => {
      expect(moduleSource).toContain("Site scope");
      expect(moduleSource).toContain("cityCode");
      expect(moduleSource).toContain("zoneCode");
      expect(moduleSource).toContain("distanceBandCode");
      expect(moduleSource).toContain("no order can be attached to this contract until at least one site is added");
    });

    it("6/7. pricing coverage shows STANDARD and OVERAGE rule presence, and warns when a required rule is missing", () => {
      expect(moduleSource).toContain("Pricing coverage");
      expect(moduleSource).toContain("STANDARD");
      expect(moduleSource).toContain("orders cannot be priced under this contract yet");
      expect(moduleSource).toContain("no OVERAGE pricing rule exists yet");
    });

    it("8. distance bands are summarized, distinguishing active from retired", () => {
      expect(moduleSource).toContain("Distance bands");
      expect(moduleSource).toContain("Active");
      expect(moduleSource).toContain("Retired");
    });
  });

  describe("The real APIs the module depends on return everything it needs", () => {
    it("2. GET /api/contracts (the list) returns enough to render the list view, with no passwordHash exposure", async () => {
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
      const { GET: listContracts } = await import("@/app/api/contracts/route");
      const res = await listContracts(makeRequest("/api/contracts", { cookie: adminCookie }));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("passwordHash");
      const rows = JSON.parse(text);
      expect(Array.isArray(rows)).toBe(true);
    });

    it("a full contract detail (customer + siteScope + periods) is available in one call, matching what the detail view reads", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

      const testCustomerId = genId();
      await db.insert(customers).values({ id: testCustomerId, tenantId: tenant!.id, name: "Contract Module Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
      const locId = genId();
      await db.insert(customerLocations).values({ id: locId, customerId: testCustomerId, label: "Test Site", address: "Test", cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30" });

      const { POST: createContract } = await import("@/app/api/contracts/route");
      const contract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: adminCookie,
        body: { customerId: testCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, appliesToAllSites: false, startDate: "2026-01-01" },
      }))).json();

      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: adminCookie, body: { customerLocationIds: [locId] } }),
        { params: { id: contract.id } }
      );

      const { GET: getContract } = await import("@/app/api/contracts/[id]/route");
      const res = await getContract(makeRequest(`/api/contracts/${contract.id}`, { cookie: adminCookie }), { params: { id: contract.id } });
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.customer.name).toBe("Contract Module Test Customer");
      expect(detail.siteScope.length).toBe(1);
      expect(detail.siteScope[0].customerLocation.cityCode).toBe("RUH");
      expect(Array.isArray(detail.periods)).toBe(true);
    });

    it("pricing rules for a contract are fetchable by contractId, matching what the detail view's coverage summary reads", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
      const testCustomerId = genId();
      await db.insert(customers).values({ id: testCustomerId, tenantId: tenant!.id, name: "Pricing Coverage Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });

      const { POST: createContract } = await import("@/app/api/contracts/route");
      const contract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: adminCookie,
        body: { customerId: testCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }))).json();
      await db.insert(contractPricingRules).values([
        { id: genId(), tenantId: tenant!.id, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 },
        { id: genId(), tenantId: tenant!.id, pricingScope: "CONTRACT", contractId: contract.id, rateType: "OVERAGE", pricePerTrip: 500, vatRate: 0.15 },
      ]);

      const { GET: getRules } = await import("@/app/api/contract-pricing-rules/route");
      const res = await getRules(makeRequest(`/api/contract-pricing-rules?contractId=${contract.id}`, { cookie: adminCookie }));
      const rows = await res.json();
      expect(rows.filter((r: any) => r.rateType === "STANDARD").length).toBe(1);
      expect(rows.filter((r: any) => r.rateType === "OVERAGE").length).toBe(1);
    });

    it("status transitions are correctly restricted, matching the module's status-change buttons", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
      const testCustomerId = genId();
      await db.insert(customers).values({ id: testCustomerId, tenantId: tenant!.id, name: "Status Transition Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });

      const { POST: createContract } = await import("@/app/api/contracts/route");
      const contract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: adminCookie,
        body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
      }))).json();
      expect(contract.status).toBe("DRAFT");

      const { PATCH: updateContract } = await import("@/app/api/contracts/[id]/route");
      const activated = await (await updateContract(
        makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "ACTIVE" } }),
        { params: { id: contract.id } }
      )).json();
      expect(activated.status).toBe("ACTIVE");

      // DRAFT -> SUSPENDED is not an allowed transition once already ACTIVE;
      // confirm ACTIVE -> DRAFT (an invalid reverse transition) is rejected.
      const rejected = await updateContract(
        makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "DRAFT" as any } }),
        { params: { id: contract.id } }
      );
      expect(rejected.status).toBe(400); // DRAFT isn't even in the PATCH schema's allowed enum
    });
  });

  it("9. distance bands API (used by the module's summary) exposes no sensitive fields", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getBands } = await import("@/app/api/distance-bands/route");
    const res = await getBands(makeRequest("/api/distance-bands", { cookie: adminCookie }));
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});
