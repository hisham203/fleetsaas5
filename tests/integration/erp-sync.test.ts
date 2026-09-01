import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// The connection-config CRUD and sync-state tracking below are tested
// against the real (test) Postgres database — that part is genuinely
// verified. The actual Odoo wire calls are mocked via vi.mock, since no
// live Odoo instance is reachable from this environment (see
// tests/unit/odoo.test.ts and the README's ERP sync section for what IS
// and ISN'T proven here).
vi.mock("@/lib/erp/odoo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/erp/odoo")>("@/lib/erp/odoo");
  return {
    ...actual,
    odooAuthenticate: vi.fn(),
    findOrCreateOdooPartner: vi.fn(),
    pushInvoiceToOdoo: vi.fn(),
  };
});

import * as odoo from "@/lib/erp/odoo";

describe("ERP sync (BR-19)", () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("has no connection configured by default", async () => {
    const { GET } = await import("@/app/api/erp/connection/route");
    const res = await GET(makeRequest("/api/erp/connection", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("saves a connection and masks the API key on read", async () => {
    const { POST: saveConnection } = await import("@/app/api/erp/connection/route");
    const saveRes = await saveConnection(makeRequest("/api/erp/connection", {
      method: "POST",
      cookie: adminCookie,
      body: {
        baseUrl: "https://test-company.odoo.com",
        database: "test_db",
        username: "integration@test.co",
        apiKey: "supersecretapikey123",
      },
    }));
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();
    expect(saved.apiKeyPreview).toBe("••••y123");
    expect(saved).not.toHaveProperty("apiKey");

    const { GET: getConnection } = await import("@/app/api/erp/connection/route");
    const getRes = await getConnection(makeRequest("/api/erp/connection", { cookie: adminCookie }));
    const fetched = await getRes.json();
    expect(fetched.baseUrl).toBe("https://test-company.odoo.com");
    expect(fetched).not.toHaveProperty("apiKey");
  });

  it("connection test reports failure clearly when Odoo auth fails, without throwing", async () => {
    vi.mocked(odoo.odooAuthenticate).mockRejectedValue(new Error("Access Denied"));
    const { POST } = await import("@/app/api/erp/connection/test/route");
    const res = await POST(makeRequest("/api/erp/connection/test", { method: "POST", cookie: adminCookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/access denied/i);
  });

  it("connection test reports success and records the uid", async () => {
    vi.mocked(odoo.odooAuthenticate).mockResolvedValue(11);
    const { POST } = await import("@/app/api/erp/connection/test/route");
    const res = await POST(makeRequest("/api/erp/connection/test", { method: "POST", cookie: adminCookie }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.uid).toBe(11);
  });

  it("syncs a single invoice, creating a partner and marking it synced", async () => {
    vi.mocked(odoo.odooAuthenticate).mockResolvedValue(11);
    vi.mocked(odoo.findOrCreateOdooPartner).mockResolvedValue(777);
    vi.mocked(odoo.pushInvoiceToOdoo).mockResolvedValue(888);

    const { GET: invoicesGet } = await import("@/app/api/invoices/route");
    const invoices = await (await invoicesGet(makeRequest("/api/invoices", { cookie: adminCookie }))).json();
    if (invoices.length === 0) return;

    const invoice = invoices[0];
    const { POST: syncInvoice } = await import("@/app/api/erp/sync/invoice/[invoiceId]/route");
    const res = await syncInvoice(
      makeRequest(`/api/erp/sync/invoice/${invoice.id}`, { method: "POST", cookie: adminCookie }),
      { params: { invoiceId: invoice.id } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.odooInvoiceId).toBe(888);

    vi.clearAllMocks();
    const res2 = await syncInvoice(
      makeRequest(`/api/erp/sync/invoice/${invoice.id}`, { method: "POST", cookie: adminCookie }),
      { params: { invoiceId: invoice.id } }
    );
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.odooInvoiceId).toBe(888);
    expect(odoo.odooAuthenticate).not.toHaveBeenCalled();
  });

  it("sync fails clearly and records the error when Odoo rejects the invoice push", async () => {
    vi.mocked(odoo.odooAuthenticate).mockResolvedValue(11);
    vi.mocked(odoo.findOrCreateOdooPartner).mockResolvedValue(777);
    vi.mocked(odoo.pushInvoiceToOdoo).mockRejectedValue(new Error("Validation Error: missing required field"));

    const { GET: invoicesGet } = await import("@/app/api/invoices/route");
    const invoices = await (await invoicesGet(makeRequest("/api/invoices", { cookie: adminCookie }))).json();
    const unsyncedInvoice = invoices.find((i: any) => !i.erpExternalId);
    if (!unsyncedInvoice) return;

    const { POST: syncInvoice } = await import("@/app/api/erp/sync/invoice/[invoiceId]/route");
    const res = await syncInvoice(
      makeRequest(`/api/erp/sync/invoice/${unsyncedInvoice.id}`, { method: "POST", cookie: adminCookie }),
      { params: { invoiceId: unsyncedInvoice.id } }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/validation error/i);

    const { GET: statusGet } = await import("@/app/api/erp/sync/status/route");
    const status = await (await statusGet(makeRequest("/api/erp/sync/status", { cookie: adminCookie }))).json();
    const found = status.find((s: any) => s.id === unsyncedInvoice.id);
    expect(found.erpSyncError).toMatch(/validation error/i);
  });

  it("a DISPATCHER session cannot access ERP endpoints (ADMIN only)", async () => {
    const dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    const { GET } = await import("@/app/api/erp/connection/route");
    const res = await GET(makeRequest("/api/erp/connection", { cookie: dispatcherCookie }));
    expect(res.status).toBe(401);
  });
});
