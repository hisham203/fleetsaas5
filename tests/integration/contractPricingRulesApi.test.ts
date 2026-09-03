import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("Contract Pricing Rules API (Task C)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;
  let jarirId: string;
  let contractId: string;
  let acmeContractId: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json();
    jarirId = customers.find((c: any) => c.name === "Jarir Bookstore HQ").id;

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 20, startDate: "2026-01-01" },
    }))).json();
    contractId = contract.id;

    const acmeCustomers = await (await customersGet(makeRequest("/api/customers", { cookie: acmeAdminCookie }))).json();
    const acmeContract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: acmeAdminCookie,
      body: { customerId: acmeCustomers[0].id, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 10, startDate: "2026-01-01" },
    }))).json();
    acmeContractId = acmeContract.id;
  });

  it("20. creates a TENANT_DEFAULT STANDARD rule", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      // cityCode included specifically so this rule can never collide with
      // another test file's TENANT_DEFAULT STANDARD rule sharing the same
      // capacity value — the same lesson from the driver/vehicle isolation
      // fix, applied here: don't rely on other files not choosing the same
      // "realistic" dimension values.
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "API_TEST_20", tankerCapacityLtr: 18000, pricePerTrip: 400 },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pricingScope).toBe("TENANT_DEFAULT");
    expect(body.contractId).toBeNull();
  });

  it("21. creates a CONTRACT STANDARD rule", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: 21000, pricePerTrip: 550 },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).contractId).toBe(contractId);
  });

  it("22. creates a CONTRACT OVERAGE rule", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "CONTRACT", contractId, rateType: "OVERAGE", tankerCapacityLtr: 21000, pricePerTrip: 700 },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).rateType).toBe("OVERAGE");
  });

  it("23. rejects a CONTRACT rule with a cross-tenant contractId", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "CONTRACT", contractId: acmeContractId, rateType: "STANDARD", pricePerTrip: 100 },
    }));
    expect(res.status).toBe(404);
  });

  it("24. rejects a TENANT_DEFAULT rule with a contractId set", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", contractId, rateType: "STANDARD", pricePerTrip: 100 },
    }));
    expect(res.status).toBe(400);
  });

  it("25. rejects an invalid rateType", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "DISCOUNT", pricePerTrip: 100 },
    }));
    expect(res.status).toBe(400);
  });

  it("26. rejects an invalid pricingScope", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "GLOBAL", rateType: "STANDARD", pricePerTrip: 100 },
    }));
    expect(res.status).toBe(400);
  });

  it("27. rejects a rule with both pricePerTrip and pricePerLiter", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "BOTHTEST", pricePerTrip: 100, pricePerLiter: 0.01 },
    }));
    expect(res.status).toBe(400);
  });

  it("28. rejects a rule with neither pricePerTrip nor pricePerLiter", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const res = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "NEITHERTEST" },
    }));
    expect(res.status).toBe(400);
  });

  it("29. lists only current tenant rules", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: acmeAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "ACME_ONLY", pricePerTrip: 999 },
    }));

    const { GET } = await import("@/app/api/contract-pricing-rules/route");
    const waterRules = await (await GET(makeRequest("/api/contract-pricing-rules", { cookie: waterAdminCookie }))).json();
    const acmeRules = await (await GET(makeRequest("/api/contract-pricing-rules", { cookie: acmeAdminCookie }))).json();
    expect(waterRules.some((r: any) => r.cityCode === "ACME_ONLY")).toBe(false);
    expect(acmeRules.some((r: any) => r.cityCode === "ACME_ONLY")).toBe(true);
  });

  it("30. read rejects a cross-tenant rule", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const acmeRule = await (await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: acmeAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "ACME_READ_TEST", pricePerTrip: 111 },
    }))).json();

    const { GET } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const res = await GET(makeRequest(`/api/contract-pricing-rules/${acmeRule.id}`, { cookie: waterAdminCookie }), { params: { id: acmeRule.id } });
    expect(res.status).toBe(404);
  });

  it("31. PATCH rejects editing price-affecting fields once the rule has started, but allows priority/effectiveEndDate", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const rule = await (await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: {
        pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "PATCH_STARTED_TEST", pricePerTrip: 100,
        effectiveStartDate: "2020-01-01", // already started
      },
    }))).json();

    const { PATCH } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const blockedRes = await PATCH(
      makeRequest(`/api/contract-pricing-rules/${rule.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { pricePerTrip: 200 } }),
      { params: { id: rule.id } }
    );
    expect(blockedRes.status).toBe(422);

    const allowedRes = await PATCH(
      makeRequest(`/api/contract-pricing-rules/${rule.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { priority: 5 } }),
      { params: { id: rule.id } }
    );
    expect(allowedRes.status).toBe(200);
    expect((await allowedRes.json()).priority).toBe(5);
  });

  it("a not-yet-started rule can have its price freely edited", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const rule = await (await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: {
        pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "PATCH_FUTURE_TEST", pricePerTrip: 100,
        effectiveStartDate: "2099-01-01", // not started yet
      },
    }))).json();

    const { PATCH } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/contract-pricing-rules/${rule.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { pricePerTrip: 250 } }),
      { params: { id: rule.id } }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).pricePerTrip).toBe(250);
  });

  it("32. DELETE soft-deactivates via effectiveEndDate, tenant-safe, never a hard row delete", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    const rule = await (await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "DELETE_TEST", pricePerTrip: 100 },
    }))).json();

    const { DELETE } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const res = await DELETE(makeRequest(`/api/contract-pricing-rules/${rule.id}`, { method: "DELETE", cookie: waterAdminCookie }), { params: { id: rule.id } });
    expect(res.status).toBe(200);

    const { GET } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const stillExists = await GET(makeRequest(`/api/contract-pricing-rules/${rule.id}`, { cookie: waterAdminCookie }), { params: { id: rule.id } });
    expect(stillExists.status).toBe(200); // row still exists — never hard-deleted
    const body = await stillExists.json();
    expect(body.effectiveEndDate).toBeTruthy();
    expect(new Date(body.effectiveEndDate).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects non-ADMIN roles", async () => {
    const dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    const { GET } = await import("@/app/api/contract-pricing-rules/route");
    const res = await GET(makeRequest("/api/contract-pricing-rules", { cookie: dispatcherCookie }));
    expect(res.status).toBe(401);
  });

  it("rejects a duplicate rule with overlapping effective dates", async () => {
    const { POST } = await import("@/app/api/contract-pricing-rules/route");
    await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "DUP_TEST", tankerCapacityLtr: 18000, pricePerTrip: 100 },
    }));
    const second = await POST(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", cityCode: "DUP_TEST", tankerCapacityLtr: 18000, pricePerTrip: 200 },
    }));
    expect(second.status).toBe(409);
  });
});
