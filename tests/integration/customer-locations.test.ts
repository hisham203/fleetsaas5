import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("B2B customer locations (APP-06)", () => {
  let dispatcherCookie: string;
  let jarirCookie: string;
  let jarirId: string;
  let rajhiId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    jarirCookie = await loginAs("portal@jarir-demo.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    jarirId = customers.find((c: any) => c.name === "Jarir Bookstore HQ").id;
    rajhiId = customers.find((c: any) => c.name === "Al Rajhi Office Tower").id;
  });

  it("a B2B customer can list its own locations (seeded with 3 for Jarir)", async () => {
    const { GET } = await import("@/app/api/customers/[id]/locations/route");
    const res = await GET(makeRequest(`/api/customers/${jarirId}/locations`, { cookie: jarirCookie }), { params: { id: jarirId } });
    expect(res.status).toBe(200);
    const locations = await res.json();
    expect(locations.length).toBeGreaterThanOrEqual(3);
  });

  it("a B2B customer can add a new location for itself", async () => {
    const { POST } = await import("@/app/api/customers/[id]/locations/route");
    const res = await POST(makeRequest(`/api/customers/${jarirId}/locations`, {
      method: "POST",
      cookie: jarirCookie,
      body: { label: "New Test Branch", address: "Test District, Riyadh", lat: 24.7, lng: 46.6, contactName: "Test Contact", contactPhone: "0500000000" },
    }), { params: { id: jarirId } });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.label).toBe("New Test Branch");

    const { GET } = await import("@/app/api/customers/[id]/locations/route");
    const locations = await (await GET(makeRequest(`/api/customers/${jarirId}/locations`, { cookie: jarirCookie }), { params: { id: jarirId } })).json();
    expect(locations.some((l: any) => l.id === created.id)).toBe(true);
  });

  it("internal staff can add a location on a B2B customer's behalf", async () => {
    const { POST } = await import("@/app/api/customers/[id]/locations/route");
    const res = await POST(makeRequest(`/api/customers/${jarirId}/locations`, {
      method: "POST",
      cookie: dispatcherCookie,
      body: { label: "Added By Dispatcher", address: "Somewhere, Riyadh" },
    }), { params: { id: jarirId } });
    expect(res.status).toBe(201);
  });

  it("rejects a location missing required fields", async () => {
    const { POST } = await import("@/app/api/customers/[id]/locations/route");
    const res = await POST(makeRequest(`/api/customers/${jarirId}/locations`, {
      method: "POST",
      cookie: jarirCookie,
      body: { label: "" },
    }), { params: { id: jarirId } });
    expect(res.status).toBe(400);
  });

  it("a B2B customer cannot add a location for a different customer", async () => {
    const { POST } = await import("@/app/api/customers/[id]/locations/route");
    const res = await POST(makeRequest(`/api/customers/${rajhiId}/locations`, {
      method: "POST",
      cookie: jarirCookie,
      body: { label: "Malicious Add", address: "Nowhere" },
    }), { params: { id: rajhiId } });
    expect(res.status).toBe(401);
  });
});
