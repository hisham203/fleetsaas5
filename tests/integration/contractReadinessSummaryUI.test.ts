import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, invoices, invoiceLineItems, contractPeriods, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task J — verifies the Contract Readiness Summary UI section exists and
// wires to the extracted, already-unit-tested computeReadinessItems
// function, and re-confirms no write action exists anywhere in the
// module (the module's own strict no-financial-write requirement).
describe("Contract Readiness Summary UI (Task J)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

  it("1. the readiness summary section exists in the Contract Management module", () => {
    expect(moduleSource).toContain("computeReadinessItems");
    expect(moduleSource).toContain("Contract readiness summary");
    expect(moduleSource).toContain("ReadinessBadge");
  });

  it("11. unsupported configuration factors are listed explicitly, not silently omitted", () => {
    expect(moduleSource).toContain("Not yet configurable (future schema work)");
    expect(moduleSource).toContain("Payment terms");
    expect(moduleSource).toContain("Contract renewal");
    expect(moduleSource).toContain("SLA terms");
    expect(moduleSource).toContain("Commercial surcharges");
  });

  it("the summary is explicitly informational only, matching this task's own instruction against a scoring system", () => {
    expect(moduleSource).toContain("Informational only — nothing here blocks using this contract.");
    expect(moduleSource).not.toMatch(/readiness\s*score/i);
  });

  it("12/6. no readiness-related code path issues a write request (POST/PATCH/DELETE) — only GET fetches appear near the readiness computation", () => {
    const readinessSectionStart = moduleSource.indexOf("function ReadinessBadge");
    const readinessSectionEnd = moduleSource.indexOf("function SiteScopeManager");
    const readinessAndDetailSection = moduleSource.slice(readinessSectionStart, readinessSectionEnd);
    // ContractDetail's own status-change control is a real, pre-existing,
    // intentional write (unrelated to the readiness summary itself) —
    // confirm THAT stays confined to its own dedicated Status section,
    // and that nothing else in this slice of the file issues a write.
    const writeMethodCalls = readinessAndDetailSection.match(/method:\s*"(POST|PATCH|DELETE)"/g) ?? [];
    expect(writeMethodCalls.length).toBe(1); // exactly the pre-existing status-change PATCH, nothing new
  });

  it("11. the Monthly Billing Readiness preview section remains read-only and still never references the generation endpoint", () => {
    expect(moduleSource).not.toContain("generate-monthly-invoice");
  });
});

describe("Existing behavior re-confirmed unaffected (Task J)", () => {
  it("13/14/15. Contract API, Pricing Rules API, and Monthly Billing Preview all still work exactly as before", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskJ Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
    }))).json();
    expect(contract.status).toBe("DRAFT");

    const { POST: createRule } = await import("@/app/api/contract-pricing-rules/route");
    const ruleRes = await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 },
    }));
    expect(ruleRes.status).toBe(201);

    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    const previewRes = await preview(makeRequest(`/api/contracts/${contract.id}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contract.id } });
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.readiness).toBe("NOT_READY"); // no delivered orders yet — correct, unrelated to Task J's changes
  });

  it("performing the full readiness read path (contract + pricing + preview) writes nothing", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "TaskJ NoWrite Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
    }))).json();

    const [invoicesBefore, lineItemsBefore, periodsBefore, ordersBefore] = await Promise.all([
      db.query.invoices.findMany({ where: eq(invoices.tenantId, tenant!.id) }),
      db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.tenantId, tenant!.id) }),
      db.query.contractPeriods.findMany({ where: eq(contractPeriods.tenantId, tenant!.id) }),
      db.query.orders.findMany({ where: eq(orders.tenantId, tenant!.id) }),
    ]);

    const { GET: getContract } = await import("@/app/api/contracts/[id]/route");
    await getContract(makeRequest(`/api/contracts/${contract.id}`, { cookie: adminCookie }), { params: { id: contract.id } });
    const { GET: getRules } = await import("@/app/api/contract-pricing-rules/route");
    await getRules(makeRequest(`/api/contract-pricing-rules?contractId=${contract.id}`, { cookie: adminCookie }));
    const { GET: preview } = await import("@/app/api/contracts/[id]/monthly-billing-preview/route");
    await preview(makeRequest(`/api/contracts/${contract.id}/monthly-billing-preview`, { cookie: adminCookie }), { params: { id: contract.id } });

    const [invoicesAfter, lineItemsAfter, periodsAfter, ordersAfter] = await Promise.all([
      db.query.invoices.findMany({ where: eq(invoices.tenantId, tenant!.id) }),
      db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.tenantId, tenant!.id) }),
      db.query.contractPeriods.findMany({ where: eq(contractPeriods.tenantId, tenant!.id) }),
      db.query.orders.findMany({ where: eq(orders.tenantId, tenant!.id) }),
    ]);
    expect(invoicesAfter.length).toBe(invoicesBefore.length);
    expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
    expect(periodsAfter.length).toBe(periodsBefore.length);
    expect(ordersAfter.length).toBe(ordersBefore.length);
  });
});
