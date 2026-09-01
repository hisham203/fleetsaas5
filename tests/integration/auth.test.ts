import { describe, it, expect } from "vitest";
import { makeRequest, loginAs, extractSessionCookie } from "../helpers/request";

describe("authentication", () => {
  it("logs in with correct credentials and returns the right role", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "admin@demo-water.co", password: "password123" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("ADMIN");
  });

  it("rejects an incorrect password", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "admin@demo-water.co", password: "wrong-password" },
    }));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@nowhere.co", password: "password123" },
    }));
    expect(res.status).toBe(401);
  });

  it("logs in a B2B customer portal account through the same endpoint", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "portal@jarir-demo.co", password: "password123" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("CUSTOMER");
  });

  it("/api/auth/me reflects the logged-in session, including driverProfileId for drivers", async () => {
    const cookie = await loginAs("khalid@demo-water.co", "password123");
    const { GET } = await import("@/app/api/auth/me/route");
    const res = await GET(makeRequest("/api/auth/me", { cookie }));
    const body = await res.json();
    expect(body.role).toBe("DRIVER");
    expect(body.driverProfileId).toBeTruthy();
  });

  it("logout invalidates the session", async () => {
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { POST: logout } = await import("@/app/api/auth/logout/route");
    await logout(makeRequest("/api/auth/logout", { method: "POST", cookie }));

    const { GET: me } = await import("@/app/api/auth/me/route");
    const res = await me(makeRequest("/api/auth/me", { cookie }));
    expect(res.status).toBe(401);
  });

  it("a DRIVER session cannot access an ADMIN/DISPATCHER-only route", async () => {
    const cookie = await loginAs("khalid@demo-water.co", "password123");
    const { GET } = await import("@/app/api/vehicles/route");
    const res = await GET(makeRequest("/api/vehicles", { cookie }));
    expect(res.status).toBe(401);
  });

  it("signup creates a brand-new, isolated tenant with a default warehouse", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const email = `owner-${Date.now()}@newco-test.co`;
    const res = await POST(makeRequest("/api/auth/signup", {
      method: "POST",
      body: {
        companyName: "Test Signup Co.",
        adminName: "Test Owner",
        adminEmail: email,
        password: "testpassword123",
        warehouseName: "Test Warehouse",
        warehouseAddress: "123 Test St",
        warehouseLat: 24.7,
        warehouseLng: 46.6,
      },
    }));
    expect(res.status).toBe(201);
    const cookie = extractSessionCookie(res);

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenant = await (await tenantGet(makeRequest("/api/tenant", { cookie }))).json();
    expect(tenant.name).toBe("Test Signup Co.");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie }))).json();
    expect(customers).toEqual([]); // fresh tenant, no data leaked in

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie }))).json();
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].name).toBe("Test Warehouse");
  });

  it("rejects signup with an already-registered email", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const res = await POST(makeRequest("/api/auth/signup", {
      method: "POST",
      body: {
        companyName: "Duplicate Co.",
        adminName: "Someone",
        adminEmail: "admin@demo-water.co", // already exists from seed data
        password: "password123",
        warehouseName: "W",
        warehouseAddress: "A",
        warehouseLat: 1,
        warehouseLng: 1,
      },
    }));
    expect(res.status).toBe(409);
  });
});
