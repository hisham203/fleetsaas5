import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("CRUD happy paths", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let tenantId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: adminCookie }))).json()).id;
  });

  describe("customers", () => {
    it("creates a B2C customer and lists it", async () => {
      const { POST: create } = await import("@/app/api/customers/route");
      const res = await create(makeRequest("/api/customers", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { name: "Test CRUD Customer", type: "B2C", address: "Test St, Riyadh" },
      }));
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.tenantId).toBe(tenantId);

      const { GET: list } = await import("@/app/api/customers/route");
      const customers = await (await list(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      expect(customers.some((c: any) => c.id === created.id)).toBe(true);
    });

    it("creates a B2B customer with a credit limit", async () => {
      const { POST: create } = await import("@/app/api/customers/route");
      const res = await create(makeRequest("/api/customers", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { name: "Test CRUD B2B Co.", type: "B2B", address: "Business Bay, Riyadh", creditLimit: 3000 },
      }));
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.type).toBe("B2B");
      expect(created.creditLimit).toBe(3000);
    });

    it("rejects a customer missing a required address", async () => {
      const { POST: create } = await import("@/app/api/customers/route");
      const res = await create(makeRequest("/api/customers", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { name: "Missing Address Co." },
      }));
      expect(res.status).toBe(400);
    });
  });

  describe("vehicles", () => {
    it("creates a vehicle and lists it", async () => {
      const { POST: create } = await import("@/app/api/vehicles/route");
      const res = await create(makeRequest("/api/vehicles", {
        method: "POST",
        cookie: adminCookie,
        body: { plateNumber: "TEST-CRUD-1", vehicleType: "Refill Van", capacityUnits: 90 },
      }));
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.status).toBe("AVAILABLE");

      const { GET: list } = await import("@/app/api/vehicles/route");
      const vehicles = await (await list(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
      expect(vehicles.some((v: any) => v.id === created.id)).toBe(true);
    });

    it("rejects a vehicle missing a required plate number", async () => {
      const { POST: create } = await import("@/app/api/vehicles/route");
      const res = await create(makeRequest("/api/vehicles", {
        method: "POST",
        cookie: adminCookie,
        body: { vehicleType: "Refill Van" },
      }));
      expect(res.status).toBe(400);
    });

    it("a DISPATCHER cannot create a vehicle (ADMIN only)", async () => {
      const { POST: create } = await import("@/app/api/vehicles/route");
      const res = await create(makeRequest("/api/vehicles", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { plateNumber: "TEST-CRUD-2", vehicleType: "Refill Van" },
      }));
      expect(res.status).toBe(401);
    });
  });

  describe("users and drivers", () => {
    it("creates a new user, then a driver profile for that user, and lists both", async () => {
      const { POST: createUser } = await import("@/app/api/users/route");
      const userRes = await createUser(makeRequest("/api/users", {
        method: "POST",
        cookie: adminCookie,
        body: { name: "Test CRUD Driver", email: `crud-driver-${Date.now()}@demo-water.co`, password: "password123", role: "DRIVER" },
      }));
      expect(userRes.status).toBe(201);
      const user = await userRes.json();
      expect(user).not.toHaveProperty("passwordHash");

      const { POST: createDriver } = await import("@/app/api/drivers/route");
      const driverRes = await createDriver(makeRequest("/api/drivers", {
        method: "POST",
        cookie: adminCookie,
        body: { userId: user.id, licenseNumber: "SA-TEST-99999", phone: "0500000001" },
      }));
      expect(driverRes.status).toBe(201);
      const driver = await driverRes.json();
      expect(driver.status).toBe("AVAILABLE");
      expect(driver.user.name).toBe("Test CRUD Driver");

      const { GET: listDrivers } = await import("@/app/api/drivers/route");
      const drivers = await (await listDrivers(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
      expect(drivers.some((d: any) => d.id === driver.id)).toBe(true);
    });

    it("rejects a driver profile for a user from another tenant", async () => {
      const acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
      const { GET: meGet } = await import("@/app/api/auth/me/route");
      const acmeUserId = (await (await meGet(makeRequest("/api/auth/me", { cookie: acmeAdminCookie }))).json()).id;

      const { POST: createDriver } = await import("@/app/api/drivers/route");
      const res = await createDriver(makeRequest("/api/drivers", {
        method: "POST",
        cookie: adminCookie,
        body: { userId: acmeUserId, licenseNumber: "SA-CROSSTENANT-1" },
      }));
      expect(res.status).toBe(404);
    });

    it("rejects a user with too short a password", async () => {
      const { POST: createUser } = await import("@/app/api/users/route");
      const res = await createUser(makeRequest("/api/users", {
        method: "POST",
        cookie: adminCookie,
        body: { name: "Short Password", email: `short-${Date.now()}@demo-water.co`, password: "123", role: "DISPATCHER" },
      }));
      expect(res.status).toBe(400);
    });

    it("a DISPATCHER cannot create users (ADMIN only)", async () => {
      const { POST: createUser } = await import("@/app/api/users/route");
      const res = await createUser(makeRequest("/api/users", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { name: "Should Fail", email: `shouldfail-${Date.now()}@demo-water.co`, password: "password123", role: "DISPATCHER" },
      }));
      expect(res.status).toBe(401);
    });
  });
});
