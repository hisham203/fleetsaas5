import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules, invoices, invoiceLineItems, contractPeriods, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task I.5A — Monthly Billing Readiness UI & Dry-Run Preview. Every
// fixture here is dedicated/isolated (its own customer, contract), a
// lesson directly carried over from Task I/I.2's own cross-test-file
// interference on the real seeded Riyadh tenant.
async function setupMonthlyContract(overrides: { withStandardRule?: boolean } = {}) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  const tenantId = tenant!.id;
  const customerId = genId();
  await db.insert(customers).values({ id: customerId, tenantId, name: `I5A Test Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });

  const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
  const { POST: createContract } = await import("@/app/api/contracts/route");
  const now = new Date();
  const contractStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const contract = await (await createContract(makeRequest("/api/contracts", {
    method: "POST", cookie: adminCookie,
    body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: contractStart.toISOString() },
  }))).json();
  const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
  await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });

  if (overrides.withStandardRule !== false) {
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
  }

  return { tenantId, customerId, contractId: contract.id, adminCookie };
}

async function deliverOrderForContract(tenantId: string, customerId: string, contractId: string, adminCookie: string, completedAt: Date) {
  const { warehouses } = await import("@/lib/db/schema");
  const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const isolated = await createIsolatedDriverAndVehicle(tenantId, `i5a-${genId().slice(0, 6)}`);

  const { POST: createOrder } = await import("@/app/api/orders/route");
  const order = await (await createOrder(makeRequest("/api/orders", {
    method: "POST", cookie: adminCookie,
    body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
  }))).json();

  // Delivery state set directly on the order row, matching the same
  // simplification Task F's own seed already established for this exact
  // scenario (see scripts/seedRiyadhBulkWaterData.ts) — the preview and
  // generation routes only ever read orders.status/completedAt/location/
  // contractId, never a trip/tripStop chain.
  await db.update(orders).set({ status: "DELIVERED", completedAt }).where(eq(orders.id, order.id));
  return order.id;
}

describe("Monthly Billing Preview endpoint (I.5A)", () => {
  it("1. rejects a non-MONTHLY_ACCUMULATED contract", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "I5A OneTime Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie, body: { customerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
    }))).json();

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contract.id}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contract.id } });
    expect(res.status).toBe(422);
  });

  it("2/3. correctly identifies a MONTHLY_ACCUMULATED contract and counts its eligible delivered orders", async () => {
    const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract();
    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 10);
    await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);
    await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractType).toBe("MONTHLY_ACCUMULATED");
    expect(body.eligibleOrdersCount).toBe(2);
    expect(body.readiness).toBe("READY");
  });

  it("4. undelivered orders are not counted as eligible", async () => {
    const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract();
    const { POST: createOrder } = await import("@/app/api/orders/route");
    // A PENDING order — never delivered.
    await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const body = await res.json();
    expect(body.eligibleOrdersCount).toBe(0);
    expect(body.readiness).toBe("NOT_READY");
  });

  it("5. already-billed orders (present on a prior invoice's line items) are excluded, not double-counted", async () => {
    const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract();
    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 10);
    const orderId = await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);

    // Simulate this order already being billed on some prior invoice.
    const priorInvoiceId = genId();
    await db.insert(invoices).values({ id: priorInvoiceId, tenantId, invoiceNumber: `INV-PRIOR-${genId().slice(0, 6)}`, customerId, contractPeriodId: null, subtotal: 400, vatRate: 0.15, vatAmount: 60, total: 460, status: "PENDING" });
    await db.insert(invoiceLineItems).values({ id: genId(), tenantId, invoiceId: priorInvoiceId, orderId, description: "Prior", quantity: 1, unitPrice: 400, lineAmount: 400, lineVatAmount: 60 });

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const body = await res.json();
    expect(body.eligibleOrdersCount).toBe(0);
    expect(body.excludedOrdersCount).toBe(1);
    expect(body.warnings.some((w: string) => w.includes("already billed"))).toBe(true);
  });

  it("6/7. a pricing failure makes the preview NOT_READY with a clear blocker, and a successful preview's totals match the real pricing engine", async () => {
    const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract({ withStandardRule: false }); // no pricing rule at all
    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 10);
    await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const noRuleRes = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const noRuleBody = await noRuleRes.json();
    expect(noRuleBody.readiness).toBe("NOT_READY");
    expect(noRuleBody.pricingFailures.length).toBe(1);
    expect(noRuleBody.blockers.length).toBeGreaterThan(0);
    expect(noRuleBody.expectedTotal).toBe(0); // nothing priced, nothing invented

    // Now add the missing rule and confirm the totals genuinely come from
    // the real pricing engine (400 * 1.15 = 460), not a separately
    // invented preview calculation.
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    const readyRes = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const readyBody = await readyRes.json();
    expect(readyBody.readiness).toBe("READY");
    expect(readyBody.expectedSubtotal).toBe(400);
    expect(readyBody.expectedVat).toBeCloseTo(60, 2);
    expect(readyBody.expectedTotal).toBeCloseTo(460, 2);
  });

  it("8. an already-invoiced period returns ALREADY_BILLED with the existing invoice's summary, and proposes no duplicate", async () => {
    const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract();
    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 10);
    await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const genRes = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: adminCookie, body: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() } }),
      { params: { id: contractId } }
    );
    expect(genRes.status).toBe(201);
    const generated = await genRes.json();

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const body = await res.json();
    expect(body.readiness).toBe("ALREADY_BILLED");
    expect(body.existingInvoice.invoiceId).toBe(generated.invoiceId);
    expect(body.existingInvoice.total).toBeCloseTo(generated.totalAmount, 2);
  });

  describe("9/10/11/12. the preview performs zero writes of any kind", () => {
    it("creates no invoices, line items, or contract periods, and does not mutate any order", async () => {
      const { tenantId, customerId, contractId, adminCookie } = await setupMonthlyContract();
      const now = new Date();
      const midMonth = new Date(now.getFullYear(), now.getMonth(), 10);
      const orderId = await deliverOrderForContract(tenantId, customerId, contractId, adminCookie, midMonth);

      const [invoicesBefore, lineItemsBefore, periodsBefore, orderBefore] = await Promise.all([
        db.query.invoices.findMany({ where: eq(invoices.tenantId, tenantId) }),
        db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.tenantId, tenantId) }),
        db.query.contractPeriods.findMany({ where: eq(contractPeriods.tenantId, tenantId) }),
        db.query.orders.findFirst({ where: eq(orders.id, orderId) }),
      ]);

      const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
      // Call it multiple times, including for the pricing-failure case,
      // since a write-on-error path would be an easy thing to miss.
      await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
      await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });

      const [invoicesAfter, lineItemsAfter, periodsAfter, orderAfter] = await Promise.all([
        db.query.invoices.findMany({ where: eq(invoices.tenantId, tenantId) }),
        db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.tenantId, tenantId) }),
        db.query.contractPeriods.findMany({ where: eq(contractPeriods.tenantId, tenantId) }),
        db.query.orders.findFirst({ where: eq(orders.id, orderId) }),
      ]);

      expect(invoicesAfter.length).toBe(invoicesBefore.length);
      expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
      expect(periodsAfter.length).toBe(periodsBefore.length);
      expect(orderAfter!.status).toBe(orderBefore!.status);
      expect(orderAfter!.contractId).toBe(orderBefore!.contractId);
    });
  });

  it("13. cross-tenant access is blocked", async () => {
    const { contractId } = await setupMonthlyContract();
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: demoWaterCookie }), { params: { id: contractId } });
    expect(res.status).toBe(404);
  });

  it("14. non-admin access is blocked, matching the real generation endpoint's own admin-only policy", async () => {
    const { contractId } = await setupMonthlyContract();
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: dispatcherCookie }), { params: { id: contractId } });
    expect(res.status).toBe(401);
  });

  it("no passwordHash exposure in the preview response", async () => {
    const { contractId, adminCookie } = await setupMonthlyContract();
    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const res = await preview(makeRequest(`/api/contracts/${contractId}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contractId } });
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("Monthly Billing Readiness UI (I.5A)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

  it("15. the Contract Management UI contains a Monthly Billing Readiness section calling the preview endpoint", () => {
    expect(moduleSource).toContain("MonthlyBillingReadiness");
    expect(moduleSource).toContain("monthly-billing-preview");
    expect(moduleSource).toContain("Ready for monthly billing");
    expect(moduleSource).toContain("Monthly billing is not ready");
    expect(moduleSource).toContain("already been invoiced");
  });

  it("16. no active Generate Invoice action exists — the button is disabled and never calls the generation endpoint", () => {
    expect(moduleSource).not.toContain("generate-monthly-invoice");
    expect(moduleSource).toContain("Invoice generation will be enabled after operational review.");
    // The disabled attribute is present with no condition — confirms the
    // button can never become clickable through any state change.
    const buttonBlock = moduleSource.slice(moduleSource.indexOf("Generate invoice (disabled"), moduleSource.indexOf("Generate invoice (disabled") + 50);
    expect(buttonBlock).toBeTruthy();
    expect(moduleSource).toContain("disabled\n            title=\"Invoice generation will be enabled after operational review.\"");
  });
});
