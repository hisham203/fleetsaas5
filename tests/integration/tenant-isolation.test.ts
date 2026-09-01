import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// These exercise the exact scenario manually verified during development:
// an authenticated user from one tenant must never be able to read another
// tenant's data, even by passing that tenant's ID as a query parameter —
// the API must derive tenant scope from the session, not the request.
describe("multi-tenant isolation", () => {
  let waterCookie: string;
  let acmeCookie: string;
  let waterTenantId: string;
  let acmeTenantId: string;

  beforeAll(async () => {
    waterCookie = await loginAs("admin@demo-water.co", "password123");
    acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const waterTenant = await (await tenantGet(makeRequest("/api/tenant", { cookie: waterCookie }))).json();
    const acmeTenant = await (await tenantGet(makeRequest("/api/tenant", { cookie: acmeCookie }))).json();
    waterTenantId = waterTenant.id;
    acmeTenantId = acmeTenant.id;
  });

  it("each admin's session resolves to their own, distinct tenant", () => {
    expect(waterTenantId).not.toBe(acmeTenantId);
  });

  it("returns each tenant's own customers, not the other's", async () => {
    const { GET } = await import("@/app/api/customers/route");

    const waterRes = await GET(makeRequest("/api/customers", { cookie: waterCookie }));
    const waterCustomers = await waterRes.json();
    expect(waterCustomers.map((c: any) => c.name)).toContain("Jarir Bookstore HQ");
    expect(waterCustomers.map((c: any) => c.name)).not.toContain("Red Sea Mall Petrol Station");

    const acmeRes = await GET(makeRequest("/api/customers", { cookie: acmeCookie }));
    const acmeCustomers = await acmeRes.json();
    expect(acmeCustomers.map((c: any) => c.name)).toContain("Red Sea Mall Petrol Station");
    expect(acmeCustomers.map((c: any) => c.name)).not.toContain("Jarir Bookstore HQ");
  });

  it("CRITICAL: ignores a client-supplied tenantId that doesn't match the session", async () => {
    const { GET } = await import("@/app/api/customers/route");

    // Acme's session tries to read customers by passing Water Co.'s tenant
    // ID as a query param. If this worked, it would be a cross-tenant data
    // leak. The route must derive tenantId from the session and ignore the
    // query param entirely.
    const res = await GET(makeRequest(`/api/customers?tenantId=${waterTenantId}`, { cookie: acmeCookie }));
    const customers = await res.json();

    expect(customers.map((c: any) => c.name)).not.toContain("Jarir Bookstore HQ");
    expect(customers.map((c: any) => c.name)).toContain("Red Sea Mall Petrol Station");
  });

  it("rejects unauthenticated requests entirely", async () => {
    const { GET } = await import("@/app/api/tenant/route");
    const res = await GET(makeRequest("/api/tenant"));
    expect(res.status).toBe(401);
  });

  it("a B2B customer session cannot read another customer's locations or statement", async () => {
    const jarirCookie = await loginAs("portal@jarir-demo.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: waterCookie }))).json();
    const rajhi = customers.find((c: any) => c.name === "Al Rajhi Office Tower");
    expect(rajhi).toBeTruthy();

    const { GET: locationsGet } = await import("@/app/api/customers/[id]/locations/route");
    const res = await locationsGet(makeRequest(`/api/customers/${rajhi.id}/locations`, { cookie: jarirCookie }), {
      params: { id: rajhi.id },
    });
    expect(res.status).toBe(401);

    const { GET: statementGet } = await import("@/app/api/customers/[id]/statement/route");
    const res2 = await statementGet(makeRequest(`/api/customers/${rajhi.id}/statement`, { cookie: jarirCookie }), {
      params: { id: rajhi.id },
    });
    expect(res2.status).toBe(401);
  });
});
