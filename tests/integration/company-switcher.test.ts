import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs, extractCookie, combineCookies } from "../helpers/request";

describe("Company Switcher (platform admin tenant switching)", () => {
  let platformAdminCookie: string;
  let waterAdminCookie: string;
  let waterTenantId: string;
  let acmeTenantId: string;

  beforeAll(async () => {
    platformAdminCookie = await loginAs("platform-admin@fleetops-demo.co", "password123");
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    waterTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
    acmeTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: acmeAdminCookie }))).json()).id;
  });

  it("GET /api/platform/tenants lists a platform admin's home tenant plus grants", async () => {
    const { GET } = await import("@/app/api/platform/tenants/route");
    const res = await GET(makeRequest("/api/platform/tenants", { cookie: platformAdminCookie }));
    expect(res.status).toBe(200);
    const tenants = await res.json();
    const ids = tenants.map((t: any) => t.id);
    expect(ids).toContain(waterTenantId); // home
    expect(ids).toContain(acmeTenantId); // explicit grant
    expect(tenants.find((t: any) => t.id === waterTenantId).isHome).toBe(true);
    expect(tenants.find((t: any) => t.id === acmeTenantId).isHome).toBe(false);
  });

  it("an ordinary tenant Admin (not a platform admin) cannot list switchable tenants", async () => {
    const { GET } = await import("@/app/api/platform/tenants/route");
    const res = await GET(makeRequest("/api/platform/tenants", { cookie: waterAdminCookie }));
    expect(res.status).toBe(403);
  });

  it("a platform admin can switch into a granted tenant, and API requests then reflect it", async () => {
    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    const switchRes = await switchTenant(
      makeRequest("/api/platform/switch-tenant", { method: "POST", cookie: platformAdminCookie, body: { tenantId: acmeTenantId } })
    );
    expect(switchRes.status).toBe(200);
    const switchedTenant = await switchRes.json();
    expect(switchedTenant.id).toBe(acmeTenantId);

    const switchCookie = extractCookie(switchRes, "active_tenant_id");
    expect(switchCookie).toBeTruthy();

    const combined = combineCookies(platformAdminCookie, switchCookie);
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const effectiveTenant = await (await tenantGet(makeRequest("/api/tenant", { cookie: combined }))).json();
    expect(effectiveTenant.id).toBe(acmeTenantId); // NOT their home tenant anymore

    // And it's not just /api/tenant — an ordinary tenant-scoped route
    // reflects the switch too, since every route derives its tenant from
    // the same getSessionTenantId() choke point.
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const acmeCustomers = await (await customersGet(makeRequest("/api/customers", { cookie: combined }))).json();
    expect(acmeCustomers.some((c: any) => c.name === "Red Sea Mall Petrol Station")).toBe(true);
    expect(acmeCustomers.some((c: any) => c.name.includes("Jarir"))).toBe(false); // not Water Co.'s data
  });

  it("switching back to the platform admin's own home tenant clears the override", async () => {
    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    const res = await switchTenant(
      makeRequest("/api/platform/switch-tenant", { method: "POST", cookie: platformAdminCookie, body: { tenantId: waterTenantId } })
    );
    expect(res.status).toBe(200);
    // Switching to home deletes the cookie rather than setting it — confirm
    // the Set-Cookie header expires/clears active_tenant_id.
    const setCookieHeader = res.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toMatch(/active_tenant_id=;/);
  });

  it("a platform admin CANNOT switch into a tenant they have no grant for", async () => {
    // Create a third tenant with no grant to the platform admin, via signup.
    const { POST: signup } = await import("@/app/api/auth/signup/route");
    const signupRes = await signup(makeRequest("/api/auth/signup", {
      method: "POST",
      body: {
        companyName: "Ungranted Co.",
        sector: "WATER_DELIVERY",
        adminName: "Test Admin",
        adminEmail: `ungranted-${Date.now()}@test.co`,
        password: "password123",
        warehouseName: "Main Depot",
        warehouseAddress: "Test Address, Riyadh",
        warehouseLat: 24.7136,
        warehouseLng: 46.6753,
      },
    }));
    const signupCookie = extractCookie(signupRes, "session_token");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const ungrantedTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: signupCookie }))).json()).id;

    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    const res = await switchTenant(
      makeRequest("/api/platform/switch-tenant", { method: "POST", cookie: platformAdminCookie, body: { tenantId: ungrantedTenantId } })
    );
    expect(res.status).toBe(403);
  });

  it("an ordinary tenant Admin cannot switch tenants at all, even into a tenant that exists", async () => {
    const { POST: switchTenant } = await import("@/app/api/platform/switch-tenant/route");
    const res = await switchTenant(
      makeRequest("/api/platform/switch-tenant", { method: "POST", cookie: waterAdminCookie, body: { tenantId: acmeTenantId } })
    );
    expect(res.status).toBe(403);
  });

  it("a tampered/forged active_tenant_id cookie cannot be used to bypass the switch endpoint", async () => {
    // waterAdmin (not a platform admin) forges the cookie directly, without
    // ever going through /api/platform/switch-tenant. getSessionFromRequest
    // must ignore it and fall back to their own tenant — not error, not leak.
    const forged = combineCookies(waterAdminCookie, `active_tenant_id=${acmeTenantId}`);
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const res = await tenantGet(makeRequest("/api/tenant", { cookie: forged }));
    expect(res.status).toBe(200);
    const tenant = await res.json();
    expect(tenant.id).toBe(waterTenantId); // still their own tenant, forged cookie ignored

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customersRes = await customersGet(makeRequest("/api/customers", { cookie: forged }));
    const customersData = await customersRes.json();
    expect(customersData.some((c: any) => c.name === "Red Sea Mall Petrol Station")).toBe(false);
  });

  it("a forged cookie also cannot grant a platform admin access to an ungranted tenant", async () => {
    const { POST: signup } = await import("@/app/api/auth/signup/route");
    const signupRes = await signup(makeRequest("/api/auth/signup", {
      method: "POST",
      body: {
        companyName: "Another Ungranted Co.",
        sector: "WATER_DELIVERY",
        adminName: "Test Admin 2",
        adminEmail: `ungranted2-${Date.now()}@test.co`,
        password: "password123",
        warehouseName: "Main Depot",
        warehouseAddress: "Test Address, Jeddah",
        warehouseLat: 21.5433,
        warehouseLng: 39.1728,
      },
    }));
    const signupCookie = extractCookie(signupRes, "session_token");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const ungrantedTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: signupCookie }))).json()).id;

    const forged = combineCookies(platformAdminCookie, `active_tenant_id=${ungrantedTenantId}`);
    const res = await tenantGet(makeRequest("/api/tenant", { cookie: forged }));
    const tenant = await res.json();
    expect(tenant.id).toBe(waterTenantId); // falls back to home, forged tenant never honored
  });

  it("existing tenant-isolation guarantees are unaffected: query-param tampering still ignored", async () => {
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const res = await customersGet(makeRequest(`/api/customers?tenantId=${waterTenantId}`, { cookie: await loginAs("admin@acme-fuel-demo.co", "password123") }));
    const data = await res.json();
    expect(data.every((c: any) => c.name !== "Al Yasmin Residence")).toBe(true); // Acme never sees Water Co.'s customers
  });
});
