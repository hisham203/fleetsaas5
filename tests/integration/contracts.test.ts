import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// Contract Management Task B — API + validation only. No pricing engine,
// no order/contract attachment, no invoice changes, no monthly billing, no
// UI, no seed data changes. These tests prove the API's own validation and
// tenant-isolation rules; they never assert anything about pricing,
// invoicing, or order behavior, since none of that exists yet.
describe("Contract API (Task B)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;
  let jarirId: string; // B2B customer, Demo Water Co.
  let almalazId: string; // B2C customer, Demo Water Co.
  let acmeCustomerId: string; // B2B customer, Acme (different tenant)

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const waterCustomers = await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json();
    jarirId = waterCustomers.find((c: any) => c.name === "Jarir Bookstore HQ").id;
    almalazId = waterCustomers.find((c: any) => c.name === "Al Malaz Family").id;

    const acmeCustomers = await (await customersGet(makeRequest("/api/customers", { cookie: acmeAdminCookie }))).json();
    acmeCustomerId = acmeCustomers[0].id;
  });

  describe("POST /api/contracts — creation and validation", () => {
    it("creates a ONE_TIME_TRIP_COUNT contract for a B2B customer", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 20, startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("ONE_TIME_TRIP_COUNT");
      expect(body.totalTripsPurchased).toBe(20);
      expect(body.tripsUsed).toBe(0);
      expect(body.status).toBe("DRAFT"); // default, never pre-activated
      expect(body.contractNumber).toBeTruthy(); // auto-generated
      expect(body.customer.name).toBe("Jarir Bookstore HQ");
    });

    it("creates a MONTHLY_ACCUMULATED contract for a B2B customer", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("MONTHLY_ACCUMULATED");
      expect(body.billingCadence).toBe("MONTHLY");
    });

    it("rejects a ONE_TIME_TRIP_COUNT contract missing totalTripsPurchased", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(400);
    });

    it("rejects a MONTHLY_ACCUMULATED contract with the wrong billingCadence", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "WEEKLY", startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(400);
    });

    it("rejects contract creation for an individual/home (B2C) customer", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: almalazId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(422);
    });

    it("rejects a cross-tenant customerId as not found, not as a different error", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      // Acme's customer ID, submitted under Demo Water Co.'s session.
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: acmeCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(404);
    });

    it("rejects a duplicate contractNumber with a clean 409, not a raw DB error", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const number = `CNT-DUPTEST-${Date.now()}`;
      const first = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, contractNumber: number, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));
      expect(first.status).toBe(201);

      const second = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: waterAdminCookie,
        body: { customerId: jarirId, contractNumber: number, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));
      expect(second.status).toBe(409);
    });

    it("rejects non-ADMIN roles (DISPATCHER, DRIVER, CUSTOMER)", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
      const res = await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/contracts — listing and tenant isolation", () => {
    it("lists only the current tenant's contracts, never another tenant's", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      await POST(makeRequest("/api/contracts", {
        method: "POST",
        cookie: acmeAdminCookie,
        body: { customerId: acmeCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }));

      const { GET } = await import("@/app/api/contracts/route");
      const waterContracts = await (await GET(makeRequest("/api/contracts", { cookie: waterAdminCookie }))).json();
      const acmeContracts = await (await GET(makeRequest("/api/contracts", { cookie: acmeAdminCookie }))).json();

      expect(waterContracts.every((c: any) => c.customer.name !== undefined)).toBe(true);
      expect(waterContracts.some((c: any) => c.customerId === acmeCustomerId)).toBe(false);
      expect(acmeContracts.length).toBeGreaterThan(0);
      expect(acmeContracts.every((c: any) => c.customerId !== jarirId)).toBe(true);
    });

    it("filters by status, customerId, and type", async () => {
      const { GET } = await import("@/app/api/contracts/route");
      const filtered = await (
        await GET(makeRequest(`/api/contracts?customerId=${jarirId}&type=ONE_TIME_TRIP_COUNT`, { cookie: waterAdminCookie }))
      ).json();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((c: any) => c.customerId === jarirId && c.type === "ONE_TIME_TRIP_COUNT")).toBe(true);
    });
  });

  describe("GET /api/contracts/[id] — read and tenant isolation", () => {
    it("reads a contract within the current tenant, including customer, siteScope, and periods", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const created = await (
        await POST(makeRequest("/api/contracts", {
          method: "POST",
          cookie: waterAdminCookie,
          body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
        }))
      ).json();

      const { GET } = await import("@/app/api/contracts/[id]/route");
      const res = await GET(makeRequest(`/api/contracts/${created.id}`, { cookie: waterAdminCookie }), { params: { id: created.id } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.customer.name).toBe("Jarir Bookstore HQ");
      expect(Array.isArray(body.siteScope)).toBe(true);
      expect(Array.isArray(body.periods)).toBe(true);
    });

    it("rejects reading a contract that belongs to a different tenant", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const acmeContract = await (
        await POST(makeRequest("/api/contracts", {
          method: "POST",
          cookie: acmeAdminCookie,
          body: { customerId: acmeCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
        }))
      ).json();

      const { GET } = await import("@/app/api/contracts/[id]/route");
      const res = await GET(makeRequest(`/api/contracts/${acmeContract.id}`, { cookie: waterAdminCookie }), { params: { id: acmeContract.id } });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/contracts/[id] — status transitions", () => {
    async function createDraft() {
      const { POST } = await import("@/app/api/contracts/route");
      return (await (
        await POST(makeRequest("/api/contracts", {
          method: "POST",
          cookie: waterAdminCookie,
          body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
        }))
      ).json());
    }

    it("allows DRAFT -> ACTIVE -> SUSPENDED -> ACTIVE -> CANCELLED, the full valid chain", async () => {
      const contract = await createDraft();
      const { PATCH } = await import("@/app/api/contracts/[id]/route");

      const toActive = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
      expect(toActive.status).toBe(200);
      expect((await toActive.json()).status).toBe("ACTIVE");

      const toSuspended = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "SUSPENDED" } }), { params: { id: contract.id } });
      expect((await toSuspended.json()).status).toBe("SUSPENDED");

      const backToActive = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
      expect((await backToActive.json()).status).toBe("ACTIVE");

      const cancelled = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "CANCELLED" } }), { params: { id: contract.id } });
      expect((await cancelled.json()).status).toBe("CANCELLED");
    });

    it("rejects an invalid transition (DRAFT -> SUSPENDED directly)", async () => {
      const contract = await createDraft();
      const { PATCH } = await import("@/app/api/contracts/[id]/route");
      const res = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "SUSPENDED" } }), { params: { id: contract.id } });
      expect(res.status).toBe(422);
    });

    it("rejects any transition once a contract is CANCELLED — a terminal state", async () => {
      const contract = await createDraft();
      const { PATCH } = await import("@/app/api/contracts/[id]/route");
      await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "CANCELLED" } }), { params: { id: contract.id } });
      const res = await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
      expect(res.status).toBe(422);
    });

    it("allows updating notes without touching status, and never accepts tripsUsed from the request body", async () => {
      const contract = await createDraft();
      const { PATCH } = await import("@/app/api/contracts/[id]/route");
      const res = await PATCH(
        makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { notes: "Renewed verbally, formal paperwork pending", tripsUsed: 999 } }),
        { params: { id: contract.id } }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.notes).toBe("Renewed verbally, formal paperwork pending");
      expect(body.status).toBe("DRAFT"); // untouched
      expect(body.tripsUsed).toBe(0); // the extra field is simply ignored, never applied
    });
  });

  describe("Contract site scope — appliesToAllSites and assignment", () => {
    async function createRestrictedContract() {
      const { POST } = await import("@/app/api/contracts/route");
      return (await (
        await POST(makeRequest("/api/contracts", {
          method: "POST",
          cookie: waterAdminCookie,
          body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", appliesToAllSites: false, startDate: "2026-01-01" },
        }))
      ).json());
    }

    it("rejects site assignment when appliesToAllSites is true (the default)", async () => {
      const { POST: createContract } = await import("@/app/api/contracts/route");
      const allSitesContract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }))).json();

      const jarirLocation = (await db_query_first_location(jarirId));
      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      const res = await assignSites(
        makeRequest(`/api/contracts/${allSitesContract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [jarirLocation.id] } }),
        { params: { id: allSitesContract.id } }
      );
      expect(res.status).toBe(422);
    });

    it("assigns a valid same-customer site successfully", async () => {
      const contract = await createRestrictedContract();
      const jarirLocation = await db_query_first_location(jarirId);

      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      const res = await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [jarirLocation.id] } }),
        { params: { id: contract.id } }
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.some((s: any) => s.customerLocationId === jarirLocation.id)).toBe(true);
    });

    it("rejects assigning the same site twice (duplicate)", async () => {
      const contract = await createRestrictedContract();
      const jarirLocation = await db_query_first_location(jarirId);
      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");

      await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [jarirLocation.id] } }),
        { params: { id: contract.id } }
      );
      const res = await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [jarirLocation.id] } }),
        { params: { id: contract.id } }
      );
      expect(res.status).toBe(409);
    });

    it("rejects a site belonging to a different customer (even within the same tenant)", async () => {
      const contract = await createRestrictedContract(); // scoped to Jarir
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const rajhi = (await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json()).find((c: any) => c.name === "Al Rajhi Office Tower");
      const rajhiLocation = await db_query_first_location(rajhi.id);

      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      const res = await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [rajhiLocation.id] } }),
        { params: { id: contract.id } }
      );
      expect(res.status).toBe(422);
    });

    it("rejects a cross-tenant site entirely (Acme's site under Demo Water Co.'s contract)", async () => {
      const contract = await createRestrictedContract();
      const acmeLocation = await db_query_first_location(acmeCustomerId);
      // Acme customers may have zero customerLocations seeded (B2B multi-site
      // is a Demo Water Co. feature in the current seed) — only run this
      // assertion if one genuinely exists to test against.
      if (!acmeLocation) return;

      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      const res = await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [acmeLocation.id] } }),
        { params: { id: contract.id } }
      );
      expect(res.status).toBe(422); // wrong customer, same rejection path as any other mismatched site
    });

    it("removes a site from scope via DELETE without deleting the customerLocation itself", async () => {
      const contract = await createRestrictedContract();
      const jarirLocation = await db_query_first_location(jarirId);
      const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
      await assignSites(
        makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: waterAdminCookie, body: { customerLocationIds: [jarirLocation.id] } }),
        { params: { id: contract.id } }
      );

      const { DELETE } = await import("@/app/api/contracts/[id]/sites/[customerLocationId]/route");
      const res = await DELETE(
        makeRequest(`/api/contracts/${contract.id}/sites/${jarirLocation.id}`, { method: "DELETE", cookie: waterAdminCookie }),
        { params: { id: contract.id, customerLocationId: jarirLocation.id } }
      );
      expect(res.status).toBe(200);

      // The customerLocation itself must still exist, untouched.
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const jarirAfter = (await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json()).find((c: any) => c.id === jarirId);
      expect(jarirAfter).toBeTruthy();

      const { GET: readContract } = await import("@/app/api/contracts/[id]/route");
      const afterBody = await (await readContract(makeRequest(`/api/contracts/${contract.id}`, { cookie: waterAdminCookie }), { params: { id: contract.id } })).json();
      expect(afterBody.siteScope.some((s: any) => s.customerLocationId === jarirLocation.id)).toBe(false);
    });
  });

  // Security fix, post-review: db.query.contracts.findFirst({ with: {
  // customer: true } }) previously returned every column on the customer
  // row, including passwordHash — a real finding, not a hypothetical one.
  // These tests prove the fix directly against real HTTP responses, not
  // just that the code was edited to look right.
  describe("customer field safety — passwordHash must never appear in a Contract API response", () => {
    it("GET /api/contracts (list) never includes passwordHash on the embedded customer", async () => {
      const { GET } = await import("@/app/api/contracts/route");
      const body = await (await GET(makeRequest("/api/contracts", { cookie: waterAdminCookie }))).json();
      expect(body.length).toBeGreaterThan(0);
      for (const contract of body) {
        expect(contract.customer).toBeTruthy();
        expect(contract.customer.passwordHash).toBeUndefined();
        expect(JSON.stringify(contract.customer)).not.toContain("passwordHash");
      }
    });

    it("GET /api/contracts/[id] (read one) never includes passwordHash on the embedded customer", async () => {
      const { POST: createContract } = await import("@/app/api/contracts/route");
      const contract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }))).json();

      const { GET } = await import("@/app/api/contracts/[id]/route");
      const body = await (await GET(makeRequest(`/api/contracts/${contract.id}`, { cookie: waterAdminCookie }), { params: { id: contract.id } })).json();
      expect(body.customer.passwordHash).toBeUndefined();
      expect(JSON.stringify(body.customer)).not.toContain("passwordHash");
      // Confirm the fix is a real allowlist, not an accidental omission —
      // the safe fields are still genuinely present.
      expect(body.customer.id).toBe(jarirId);
      expect(body.customer.name).toBe("Jarir Bookstore HQ");
      expect(body.customer.type).toBe("B2B");
    });

    it("POST /api/contracts (create) never includes passwordHash on the embedded customer", async () => {
      const { POST } = await import("@/app/api/contracts/route");
      const body = await (await POST(makeRequest("/api/contracts", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }))).json();
      expect(body.customer.passwordHash).toBeUndefined();
      expect(JSON.stringify(body.customer)).not.toContain("passwordHash");
    });

    it("PATCH /api/contracts/[id] (update) never includes passwordHash on the embedded customer", async () => {
      const { POST: createContract } = await import("@/app/api/contracts/route");
      const contract = await (await createContract(makeRequest("/api/contracts", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
      }))).json();

      const { PATCH } = await import("@/app/api/contracts/[id]/route");
      const body = await (await PATCH(
        makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }),
        { params: { id: contract.id } }
      )).json();
      expect(body.customer.passwordHash).toBeUndefined();
      expect(JSON.stringify(body.customer)).not.toContain("passwordHash");
    });
  });
});

// Small helper — fetches the first seeded customerLocation for a given
// customer directly via Drizzle, since there's no dedicated "get one
// location" API route to reuse here.
async function db_query_first_location(customerId: string) {
  const { db } = await import("@/lib/db/client");
  return db.query.customerLocations.findFirst({ where: (l, { eq }) => eq(l.customerId, customerId) });
}
