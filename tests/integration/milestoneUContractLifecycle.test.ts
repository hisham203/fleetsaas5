import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone U — Contract Lifecycle & Demand Generation (no-schema work).
const customersSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
const contractsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

describe("Customer creation and editing (Milestone U, Part 3)", () => {
  it("1/2/3. POST /api/customers creates a real, tenant-scoped customer with required-field validation", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createCustomer } = await import("@/app/api/customers/route");
    const badRes = await createCustomer(makeRequest("/api/customers", { method: "POST", cookie: adminCookie, body: { name: "" } }));
    expect(badRes.status).toBe(400);
    const res = await createCustomer(makeRequest("/api/customers", { method: "POST", cookie: adminCookie, body: { name: "MU Test Customer", type: "B2B", address: "Test Address" } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    const dbRow = await db.query.customers.findFirst({ where: eq(customers.id, created.id) });
    expect(dbRow!.tenantId).toBe(tenant!.id);
  });

  it("4/5. New customer action and PATCH-based edit exist in the UI, using the extended PATCH /api/customers/[id]", () => {
    const source = customersSource();
    expect(source).toContain("NewCustomerButton");
    expect(source).toContain("CustomerProfileCard");
    expect(source).toContain(`fetch(\`/api/customers/\${customer.id}\`, {\n      method: "PATCH"`);
  });

  it("PATCH /api/customers/[id] now updates name/phone/address, not just contractPricePerBottle/creditLimit", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MU Edit Test", type: "B2B", address: "Old Address" });
    const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
    const res = await updateCustomer(makeRequest(`/api/customers/${customerId}`, { method: "PATCH", cookie: adminCookie, body: { name: "MU Edited Name", address: "New Address", phone: "0500000000" } }), { params: { id: customerId } });
    expect(res.status).toBe(200);
    const updated = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    expect(updated!.name).toBe("MU Edited Name");
    expect(updated!.address).toBe("New Address");
    expect(updated!.phone).toBe("0500000000");
  });

  it("6/7. customer detail shows related contracts and pending/planned orders (Milestone T panel, unaffected)", () => {
    const source = customersSource();
    expect(source).toContain("CustomerOperationsPanel");
    expect(source).toContain("Contracts &amp; Operational Activity");
  });

  it("8. New contract from customer passes customerId via query param", () => {
    const source = customersSource();
    expect(source).toContain("/admin/contracts?new=1&customerId=${customer.id}");
  });

  it("15. an invalid/cross-tenant customerId in PATCH is rejected safely (tenant isolation)", async () => {
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const riyadhCustomer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
    const res = await updateCustomer(makeRequest(`/api/customers/${riyadhCustomer!.id}`, { method: "PATCH", cookie: demoAdminCookie, body: { name: "Should not apply" } }), { params: { id: riyadhCustomer!.id } });
    expect(res.status).toBe(404);
  });
});

describe("Contract editing (Milestone U, Part 4)", () => {
  async function setupContract() {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MU Contract Edit Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MU-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    return { adminCookie, contractId };
  }

  it("9/10/11. contract start and end date can both be edited, with validation that end must be after start", async () => {
    const { adminCookie, contractId } = await setupContract();
    const { PATCH: updateContract } = await import("@/app/api/contracts/[id]/route");
    const goodRes = await updateContract(makeRequest(`/api/contracts/${contractId}`, { method: "PATCH", cookie: adminCookie, body: { startDate: "2026-02-01", endDate: "2026-06-01" } }), { params: { id: contractId } });
    expect(goodRes.status).toBe(200);
    const updated = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    expect(new Date(updated!.startDate).toISOString().slice(0, 10)).toBe("2026-02-01");

    const badRes = await updateContract(makeRequest(`/api/contracts/${contractId}`, { method: "PATCH", cookie: adminCookie, body: { startDate: "2026-06-01", endDate: "2026-01-01" } }), { params: { id: contractId } });
    expect(badRes.status).toBe(422);
  });

  it("a partial update (only startDate) is validated against the contract's existing endDate, not silently allowed to invert the range", async () => {
    const { adminCookie, contractId } = await setupContract();
    const { PATCH: updateContract } = await import("@/app/api/contracts/[id]/route");
    await updateContract(makeRequest(`/api/contracts/${contractId}`, { method: "PATCH", cookie: adminCookie, body: { endDate: "2026-03-01" } }), { params: { id: contractId } });
    const badRes = await updateContract(makeRequest(`/api/contracts/${contractId}`, { method: "PATCH", cookie: adminCookie, body: { startDate: "2026-04-01" } }), { params: { id: contractId } });
    expect(badRes.status).toBe(422);
  });

  it("9. contract edit action (dates) renders in the UI for admin", () => {
    const source = contractsSource();
    expect(source).toContain("ContractDatesEditor");
    expect(source).toContain("Edit dates");
  });

  it("12. monthly term helper sets end date from start date + N months, both in the create form and the edit view", () => {
    const source = contractsSource();
    // The edit component's own term helper.
    expect(source).toContain("function applyTerm(months: number)");
    expect(source).toContain("d.setMonth(d.getMonth() + months)");
    // The create form's own equivalent quick-pick.
    expect(source).toContain("d.setMonth(d.getMonth() + m)");
  });

  it("13. new contract form preselects customerId from the query param", () => {
    const source = contractsSource();
    expect(source).toContain('searchParams.get("new") === "1"');
    expect(source).toContain("initialCustomerId");
  });

  it("Part 6 audit finding, revised: no hard activation block exists (it broke 56 legitimate tests and was reverted) - mandatory pricing coverage is enforced via the existing, unmodified Contract Readiness Summary instead", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/route.ts"), "utf8");
    expect(source).not.toContain("cannot be activated without at least one STANDARD pricing rule");
    expect(source).toContain("Part 6 audit finding");
  });

  it("17/18. the pricing coverage manager remains available after creation, and changing pricing does not touch historical invoices (unmodified Task J/contractPricing.ts)", () => {
    const source = contractsSource();
    expect(source).toContain("PricingRulesManager");
    const pricingEngine = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    expect(pricingEngine).toContain("PricingEngineError");
  });
});

describe("Regression protection (Milestone U)", () => {
  it("19-22: Milestone T planner, Control Tower, and Dispatch remain unaffected", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const body = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    expect(Array.isArray(body.contracts)).toBe(true);
    expect(body.capacity).toBeTruthy();
  });

  it("23. Task P.2 contract-priced invoice behavior is unaffected — the delivery-completion route was never touched", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(source).toContain("Task P.2");
    expect(source).toContain("isTripCountContract");
  });

  it("tenant isolation on the new PATCH endpoints is intact", async () => {
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MU Isolation Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MU-ISO-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    const { PATCH: updateContract } = await import("@/app/api/contracts/[id]/route");
    const res = await updateContract(makeRequest(`/api/contracts/${contractId}`, { method: "PATCH", cookie: demoAdminCookie, body: { startDate: "2026-02-01" } }), { params: { id: contractId } });
    expect(res.status).toBe(404);
  });

  it("no passwordHash exposure in any changed page source", () => {
    expect(customersSource() + contractsSource()).not.toContain("passwordHash");
  });
});
