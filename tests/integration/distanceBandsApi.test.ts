import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("Distance Bands API (Task C)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
  });

  it("33. creates a distance band", async () => {
    const { POST } = await import("@/app/api/distance-bands/route");
    const res = await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_BAND_A", fromKm: 0, toKm: 10, label: "0-10km" },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe("TEST_BAND_A");
    expect(body.isActive).toBe(true);
  });

  it("34. rejects a duplicate code inside the same tenant", async () => {
    const { POST } = await import("@/app/api/distance-bands/route");
    await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_BAND_DUP", fromKm: 0, toKm: 5, label: "First" },
    }));
    const second = await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_BAND_DUP", fromKm: 10, toKm: 15, label: "Second" },
    }));
    expect(second.status).toBe(409);
  });

  it("35. allows the same code across different tenants (uniqueness is tenant-scoped, not global)", async () => {
    const { POST } = await import("@/app/api/distance-bands/route");
    const waterBand = await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_SHARED_CODE", fromKm: 0, toKm: 10, label: "Water Co version" },
    }));
    const acmeBand = await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: acmeAdminCookie,
      body: { code: "TEST_SHARED_CODE", fromKm: 0, toKm: 20, label: "Acme version" },
    }));
    expect(waterBand.status).toBe(201);
    expect(acmeBand.status).toBe(201);
  });

  it("36. rejects invalid fromKm/toKm (toKm must exceed fromKm)", async () => {
    const { POST } = await import("@/app/api/distance-bands/route");
    const res = await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_INVALID_RANGE", fromKm: 20, toKm: 10, label: "Backwards" },
    }));
    expect(res.status).toBe(400);
  });

  it("37. retires a band safely, setting isActive false and retiredAt, without deleting the row", async () => {
    const { POST } = await import("@/app/api/distance-bands/route");
    const band = await (await POST(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_RETIRE", fromKm: 0, toKm: 10, label: "To be retired" },
    }))).json();

    const { DELETE } = await import("@/app/api/distance-bands/[id]/route");
    const res = await DELETE(makeRequest(`/api/distance-bands/${band.id}`, { method: "DELETE", cookie: waterAdminCookie }), { params: { id: band.id } });
    expect(res.status).toBe(200);

    const { GET } = await import("@/app/api/distance-bands/route");
    const all = await (await GET(makeRequest("/api/distance-bands", { cookie: waterAdminCookie }))).json();
    const retired = all.find((b: any) => b.id === band.id);
    expect(retired).toBeTruthy(); // still exists
    expect(retired.isActive).toBe(false);
    expect(retired.retiredAt).toBeTruthy();
  });

  it("38. prevents editing the range of a band already referenced by a pricing rule", async () => {
    const { POST: createBand } = await import("@/app/api/distance-bands/route");
    const band = await (await createBand(makeRequest("/api/distance-bands", {
      method: "POST", cookie: waterAdminCookie,
      body: { code: "TEST_IN_USE", fromKm: 0, toKm: 10, label: "Will be referenced" },
    }))).json();

    const { POST: createRule } = await import("@/app/api/contract-pricing-rules/route");
    await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: waterAdminCookie,
      body: { pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", distanceBandCode: "TEST_IN_USE", pricePerTrip: 100 },
    }));

    const { PATCH } = await import("@/app/api/distance-bands/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/distance-bands/${band.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { fromKm: 5 } }),
      { params: { id: band.id } }
    );
    expect(res.status).toBe(422);

    // But the label (cosmetic, not range-defining) is still freely editable.
    const labelRes = await PATCH(
      makeRequest(`/api/distance-bands/${band.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { label: "Renamed" } }),
      { params: { id: band.id } }
    );
    expect(labelRes.status).toBe(200);
    expect((await labelRes.json()).label).toBe("Renamed");
  });

  it("rejects non-ADMIN roles and cross-tenant reads", async () => {
    const dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    const { GET } = await import("@/app/api/distance-bands/route");
    const res = await GET(makeRequest("/api/distance-bands", { cookie: dispatcherCookie }));
    expect(res.status).toBe(401);
  });
});
