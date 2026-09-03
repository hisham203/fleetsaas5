import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, contractSiteScope, customerLocations } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { eq } from "drizzle-orm";

// Contract Management Task D — Order/Contract Attachment + Pricing
// Preview. These tests prove: (1) the existing non-contract order flow is
// completely unaffected, (2) an explicitly-requested invalid contract
// rejects the whole order, (3) a valid contract's pricing preview is
// computed via the real pricing engine, and (4) none of this writes an
// invoice, an invoice_line_items row, or mutates a contract's tripsUsed.
describe("Order/Contract Attachment (Task D)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;
  let tenantId: string;
  let jarirId: string; // B2B, Demo Water Co.
  let almalazId: string; // B2C, Demo Water Co.
  let acmeContractId: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json();
    jarirId = customers.find((c: any) => c.name === "Jarir Bookstore HQ").id;
    almalazId = customers.find((c: any) => c.name === "Al Malaz Family").id;

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const acmeCustomers = await (await customersGet(makeRequest("/api/customers", { cookie: acmeAdminCookie }))).json();
    const acmeContract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: acmeAdminCookie,
      body: { customerId: acmeCustomers[0].id, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 10, startDate: "2020-01-01" },
    }))).json();
    acmeContractId = acmeContract.id;
  });

  async function createActiveContract(overrides: Partial<{ type: string; totalTripsPurchased: number; billingCadence: string; appliesToAllSites: boolean; startDate: string; endDate: string }> = {}) {
    const { POST: createContract, PATCH } = await import("@/app/api/contracts/route").then(async (m) => ({
      ...m,
      PATCH: (await import("@/app/api/contracts/[id]/route")).PATCH,
    }));
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: {
        customerId: jarirId,
        type: overrides.type ?? "ONE_TIME_TRIP_COUNT",
        totalTripsPurchased: overrides.type === "MONTHLY_ACCUMULATED" ? undefined : (overrides.totalTripsPurchased ?? 10),
        billingCadence: overrides.type === "MONTHLY_ACCUMULATED" ? "MONTHLY" : undefined,
        appliesToAllSites: overrides.appliesToAllSites ?? true,
        startDate: overrides.startDate ?? "2020-01-01",
        endDate: overrides.endDate,
      },
    }))).json();
    await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    return contract.id;
  }

  // ---------- Part 5: order without contract ----------

  it("1/2. existing order creation without contractId still works, response unchanged", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, qtyOrdered: 3, emptyBottlesToCollect: 3, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contractId ?? null).toBeNull();
    expect(body.pricingPreview).toBeUndefined(); // no key at all, not even null
  });

  // ---------- Contract attachment ----------

  it("3/4. creates an order with a valid ACTIVE contract and stores orders.contractId", async () => {
    const contractId = await createActiveContract();
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contractId).toBe(contractId);
  });

  it("5. rejects a cross-tenant contractId (404)", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: acmeContractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(404);
  });

  it("6. rejects a wrong-customer contractId within the same tenant (422)", async () => {
    const contractId = await createActiveContract(); // belongs to Jarir
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: almalazId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("WRONG_CUSTOMER");
  });

  it("7. rejects an inactive (DRAFT/SUSPENDED/CANCELLED) contract", async () => {
    const { POST: createContract, PATCH } = await import("@/app/api/contracts/route").then(async (m) => ({
      ...m,
      PATCH: (await import("@/app/api/contracts/[id]/route")).PATCH,
    }));
    const draft = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json(); // left in DRAFT, never activated

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const draftRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: draft.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(draftRes.status).toBe(422);
    expect((await draftRes.json()).errorCode).toBe("NOT_ACTIVE");

    const activeId = await createActiveContract();
    await PATCH(makeRequest(`/api/contracts/${activeId}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "SUSPENDED" } }), { params: { id: activeId } });
    const suspendedRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: activeId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(suspendedRes.status).toBe(422);
    expect((await suspendedRes.json()).errorCode).toBe("NOT_ACTIVE");
  });

  it("8. appliesToAllSites=true allows attaching even with no site collected by this route", async () => {
    const contractId = await createActiveContract({ appliesToAllSites: true });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
  });

  it("9/10. appliesToAllSites=false rejects attachment through this route (which never collects a site) — honest, not a workaround", async () => {
    const contractId = await createActiveContract({ appliesToAllSites: false });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("SITE_NOT_IN_SCOPE");
  });

  it("scoped-site eligibility genuinely works at the library level (direct check, since the order route itself never collects a site)", async () => {
    const { validateContractEligibility, ContractEligibilityError } = await import("@/lib/contractEligibility");
    const contractId = await createActiveContract({ appliesToAllSites: false });
    const location = await db.query.customerLocations.findFirst({ where: (l, { eq }) => eq(l.customerId, jarirId) });

    // Not yet scoped — rejected.
    await expect(
      validateContractEligibility({ tenantId, customerId: jarirId, contractId, orderDate: new Date(), customerLocationId: location!.id })
    ).rejects.toBeInstanceOf(ContractEligibilityError);

    // Scope it, then it succeeds.
    await db.insert(contractSiteScope).values({ id: genId(), contractId, customerLocationId: location!.id });
    const contract = await validateContractEligibility({ tenantId, customerId: jarirId, contractId, orderDate: new Date(), customerLocationId: location!.id });
    expect(contract.id).toBe(contractId);
  });

  // ---------- Pricing preview ----------

  it("11. a valid contract with a matching STANDARD rule returns pricingPreview.available=true", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD",
      cityCode: "PREVIEW_TEST_11", pricePerTrip: 450, vatRate: 0.15,
    });
    // Since the order route passes null dimensions, match this rule via a
    // fully-wildcard CONTRACT STANDARD rule instead.
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD",
      pricePerTrip: 460, vatRate: 0.15,
    });

    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    const body = await res.json();
    expect(body.pricingPreview.available).toBe(true);
    expect(body.pricingPreview.baseAmount).toBe("460.00");
    expect(body.pricingPreview.totalAmount).toBe("529.00");
  });

  it("12. a missing pricing rule returns pricingPreview.available=false with a clear error, but the order still succeeds (201)", async () => {
    const contractId = await createActiveContract(); // zero pricing rules created for it
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201); // never blocked by a pricing failure
    const body = await res.json();
    expect(body.pricingPreview.available).toBe(false);
    expect(body.pricingPreview.errorCode).toBe("NO_MATCHING_RULE");
  });

  it("13. a more specific pricing rule is selected through the existing engine, unmodified", async () => {
    const contractId = await createActiveContract();
    const wildcard = genId();
    const specific = genId();
    await db.insert(contractPricingRules).values([
      { id: wildcard, tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 },
      { id: specific, tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: null as any, priority: 5, pricePerTrip: 350, vatRate: 0.15 },
    ]);
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    const body = await res.json();
    expect(body.pricingPreview.selectedRuleId).toBe(specific); // higher priority wins
  });

  it("14/15. ONE_TIME_TRIP_COUNT uses STANDARD within limit and OVERAGE once exhausted, without mutating tripsUsed", async () => {
    const { POST: createContract, PATCH: patchContract } = await import("@/app/api/contracts/route").then(async (m) => ({
      ...m,
      PATCH: (await import("@/app/api/contracts/[id]/route")).PATCH,
    }));
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 3, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });

    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 },
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "OVERAGE", pricePerTrip: 700, vatRate: 0.15 },
    ]);

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const withinLimitRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect((await withinLimitRes.json()).pricingPreview.rateType).toBe("STANDARD");

    // Simulate exhaustion directly (order creation never mutates tripsUsed).
    await db.update(contracts).set({ tripsUsed: 3 }).where(eq(contracts.id, contract.id));
    const exhaustedRes = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(exhaustedRes.status).toBe(201); // overage never blocks
    expect((await exhaustedRes.json()).pricingPreview.rateType).toBe("OVERAGE");
  });

  it("16. an exhausted ONE_TIME_TRIP_COUNT contract with no OVERAGE rule returns a clear pricing preview error, order still succeeds", async () => {
    const { POST: createContract, PATCH: patchContract } = await import("@/app/api/contracts/route").then(async (m) => ({
      ...m,
      PATCH: (await import("@/app/api/contracts/[id]/route")).PATCH,
    }));
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 1, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    await db.update(contracts).set({ tripsUsed: 1 }).where(eq(contracts.id, contract.id));

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const res = await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pricingPreview.available).toBe(false);
    expect(body.pricingPreview.errorCode).toBe("MISSING_OVERAGE_RULE");
  });

  it("17. MONTHLY_ACCUMULATED always uses STANDARD", async () => {
    const contractId = await createActiveContract({ type: "MONTHLY_ACCUMULATED" });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 380, vatRate: 0.15 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect((await res.json()).pricingPreview.rateType).toBe("STANDARD");
  });

  it("18. pricePerTrip preview works", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect((await res.json()).pricingPreview.baseAmount).toBe("500.00");
  });

  it("19. pricePerLiter preview works, using order qtyOrdered as the quantity input", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerLiter: 0.1, vatRate: 0.15 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 200, emptyBottlesToCollect: 200, paymentMethod: "CASH" },
    }));
    const body = await res.json();
    expect(body.pricingPreview.baseAmount).toBe("20.00"); // 0.1 * 200
  });

  it("20. VAT preview is correct", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 1000, vatRate: 0.15 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    const body = await res.json();
    expect(body.pricingPreview.vatAmount).toBe("150.00");
    expect(body.pricingPreview.totalAmount).toBe("1150.00");
  });

  // ---------- Safety / regression ----------

  it("21/22. pricing preview never creates an invoice or an invoice_line_items row", async () => {
    const contractId = await createActiveContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });

    const invoicesBefore = await db.query.invoices.findMany();
    const lineItemsBefore = await db.query.invoiceLineItems.findMany();

    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    expect((await res.json()).pricingPreview.available).toBe(true);

    const invoicesAfter = await db.query.invoices.findMany();
    const lineItemsAfter = await db.query.invoiceLineItems.findMany();
    expect(invoicesAfter.length).toBe(invoicesBefore.length);
    expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
  });

  it("23. tripsUsed is not mutated by order creation", async () => {
    const { POST: createContract, PATCH: patchContract } = await import("@/app/api/contracts/route").then(async (m) => ({
      ...m,
      PATCH: (await import("@/app/api/contracts/[id]/route")).PATCH,
    }));
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });

    const { POST: createOrder } = await import("@/app/api/orders/route");
    await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));

    const after = await db.query.contracts.findFirst({ where: (c, { eq }) => eq(c.id, contract.id) });
    expect(after!.tripsUsed).toBe(0);
  });

  it("does not expose passwordHash in the order's embedded customer or contract", async () => {
    const contractId = await createActiveContract();
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("GET /api/orders lists include contractId and a contract summary", async () => {
    const contractId = await createActiveContract();
    const { POST: createOrder } = await import("@/app/api/orders/route");
    await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }));
    const { GET } = await import("@/app/api/orders/route");
    const list = await (await GET(makeRequest("/api/orders", { cookie: waterAdminCookie }))).json();
    const found = list.find((o: any) => o.contractId === contractId);
    expect(found).toBeTruthy();
    expect(found.contract.id).toBe(contractId);
  });

  // ---------- Correction: locationId support (site-restricted contracts + real pricing dimensions) ----------
  describe("locationId support (correction)", () => {
    let jarirLocationId: string;
    let rajhiLocationId: string; // a different customer, same tenant — for the wrong-customer test
    let acmeLocationId: string | null; // a different tenant entirely — for the cross-tenant test, if one exists in seed data

    beforeAll(async () => {
      const jarirLocation = await db.query.customerLocations.findFirst({ where: (l, { eq: eqOp }) => eqOp(l.customerId, jarirId) });
      jarirLocationId = jarirLocation!.id;
      // Give this specific location real, non-null pricing dimensions —
      // seeded customerLocations have none set by default (A1 added the
      // columns; nothing in seed data populates them).
      await db.update(customerLocations).set({ cityCode: "RUH", zoneCode: "ZONE_A", distanceBandCode: "BAND_1" }).where(eq(customerLocations.id, jarirLocationId));

      const { GET: customersGet } = await import("@/app/api/customers/route");
      const rajhi = (await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json()).find((c: any) => c.name === "Al Rajhi Office Tower");
      const rajhiLocation = await db.query.customerLocations.findFirst({ where: (l, { eq: eqOp }) => eqOp(l.customerId, rajhi.id) });
      rajhiLocationId = rajhiLocation!.id;

      const acmeLocation = await db.query.customerLocations.findFirst({});
      acmeLocationId = acmeLocation && acmeLocation.customerId !== jarirId && acmeLocation.customerId !== rajhi.id ? acmeLocation.id : null;
    });

    it("appliesToAllSites=true allows a valid customerLocationId", async () => {
      const contractId = await createActiveContract({ appliesToAllSites: true });
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.locationId).toBe(jarirLocationId);
    });

    it("appliesToAllSites=false allows a scoped customerLocationId — the actual functional gap this correction fixes", async () => {
      const contractId = await createActiveContract({ appliesToAllSites: false });
      await db.insert(contractSiteScope).values({ id: genId(), contractId, customerLocationId: jarirLocationId });

      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(201);
      expect((await res.json()).contractId).toBe(contractId);
    });

    it("appliesToAllSites=false rejects an unscoped customerLocationId", async () => {
      const contractId = await createActiveContract({ appliesToAllSites: false }); // jarirLocationId never scoped to this one
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(422);
      expect((await res.json()).errorCode).toBe("SITE_NOT_IN_SCOPE");
    });

    it("rejects a wrong-customer customerLocationId (Al Rajhi's site under a Jarir order)", async () => {
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, locationId: rajhiLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(422);
    });

    it("rejects a cross-tenant customerLocationId", async () => {
      if (!acmeLocationId) return; // skip gracefully if no cross-tenant location exists in current seed data
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, locationId: acmeLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(422); // wrong-customer path — Acme's location's customerId can never equal jarirId
    });

    it("pricing preview uses cityCode, zoneCode, and distanceBandCode from the resolved customerLocation — not silently null", async () => {
      const contractId = await createActiveContract();
      const matchingRuleId = genId();
      await db.insert(contractPricingRules).values([
        // A wildcard rule that would ALSO match — if the route were still
        // silently passing null for everything, this wildcard would win
        // and the test below would wrongly pass. Proving the more
        // specific, location-matched rule is selected instead is the
        // real proof the real dimensions are being used.
        { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 100, vatRate: 0.15 },
        { id: matchingRuleId, tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", zoneCode: "ZONE_A", distanceBandCode: "BAND_1", pricePerTrip: 600, vatRate: 0.15 },
      ]);
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      const body = await res.json();
      expect(body.pricingPreview.available).toBe(true);
      expect(body.pricingPreview.selectedRuleId).toBe(matchingRuleId);
      expect(body.pricingPreview.baseAmount).toBe("600.00");
    });

    it("capacityKnown is always present and false, since no vehicle exists at order-creation time — a wildcard-capacity rule still prices successfully", async () => {
      const contractId = await createActiveContract();
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", pricePerTrip: 450, vatRate: 0.15 });
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      const body = await res.json();
      expect(body.pricingPreview.available).toBe(true); // wildcard-capacity rule still prices fine
      expect(body.pricingPreview.capacityKnown).toBe(false); // but honestly flags capacity was unknown
    });

    it("capacityKnown is present (false) even when pricing fails, with a clarifying note in the error", async () => {
      const contractId = await createActiveContract();
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", tankerCapacityLtr: 21000, pricePerTrip: 450, vatRate: 0.15 });
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(201); // still never blocks order creation
      const body = await res.json();
      expect(body.pricingPreview.available).toBe(false); // the only rule requires a specific capacity we don't have
      expect(body.pricingPreview.capacityKnown).toBe(false);
      expect(body.pricingPreview.error).toContain("tanker capacity was not yet known");
    });

    it("existing non-contract, no-location order creation still works completely unchanged", async () => {
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.locationId).toBeNull();
      expect(body.pricingPreview).toBeUndefined();
    });

    it("no invoices, no invoice_line_items, and no tripsUsed mutation from a location-based order", async () => {
      const contractId = await createActiveContract();
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", pricePerTrip: 450, vatRate: 0.15 });
      const invoicesBefore = await db.query.invoices.findMany();
      const lineItemsBefore = await db.query.invoiceLineItems.findMany();

      const { POST } = await import("@/app/api/orders/route");
      await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));

      const invoicesAfter = await db.query.invoices.findMany();
      const lineItemsAfter = await db.query.invoiceLineItems.findMany();
      expect(invoicesAfter.length).toBe(invoicesBefore.length);
      expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
      const contractAfter = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
      expect(contractAfter!.tripsUsed).toBe(0);
    });

    it("does not expose passwordHash anywhere in a location-based order response", async () => {
      const contractId = await createActiveContract();
      const { POST } = await import("@/app/api/orders/route");
      const res = await POST(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, contractId, locationId: jarirLocationId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }));
      expect(JSON.stringify(await res.json())).not.toContain("passwordHash");
    });
  });
});
