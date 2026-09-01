import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { odooAuthenticate, odooExecuteKw, findOrCreateOdooPartner, pushInvoiceToOdoo } from "@/lib/erp/odoo";

// IMPORTANT: these tests validate that this client speaks Odoo's documented
// JSON-RPC contract correctly (https://www.odoo.com/documentation/17.0/
// developer/reference/external_api.html) — request shape, response parsing,
// error handling — using a mocked fetch. They do NOT prove a real Odoo
// server behaves exactly as documented, because no live Odoo instance is
// reachable from this environment. Before relying on this in production,
// run POST /api/erp/connection/test against your actual Odoo instance.

const config = { baseUrl: "https://example.odoo.com", database: "mydb", username: "admin", apiKey: "fake-key" };

function mockFetchOnce(responseBody: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => responseBody,
  }) as any;
}

describe("Odoo JSON-RPC client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("odooAuthenticate", () => {
    it("sends the documented common.authenticate request shape", async () => {
      mockFetchOnce({ jsonrpc: "2.0", id: 1, result: 7 });
      const uid = await odooAuthenticate(config);
      expect(uid).toBe(7);

      const call = (global.fetch as any).mock.calls[0];
      expect(call[0]).toBe("https://example.odoo.com/jsonrpc");
      const body = JSON.parse(call[1].body);
      expect(body.method).toBe("call");
      expect(body.params.service).toBe("common");
      expect(body.params.method).toBe("authenticate");
      expect(body.params.args).toEqual(["mydb", "admin", "fake-key", {}]);
    });

    it("throws a clear error when Odoo returns `false` for bad credentials", async () => {
      mockFetchOnce({ jsonrpc: "2.0", id: 1, result: false });
      await expect(odooAuthenticate(config)).rejects.toThrow(/authentication failed/i);
    });

    it("throws with Odoo's own error message when the RPC call itself errors", async () => {
      mockFetchOnce({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "Odoo Server Error", data: { message: "Access Denied" } },
      });
      await expect(odooAuthenticate(config)).rejects.toThrow(/access denied/i);
    });

    it("throws on a non-OK HTTP response (e.g. wrong base URL)", async () => {
      mockFetchOnce({}, false);
      await expect(odooAuthenticate(config)).rejects.toThrow(/http 500/i);
    });
  });

  describe("odooExecuteKw", () => {
    it("sends the documented object.execute_kw request shape", async () => {
      mockFetchOnce({ jsonrpc: "2.0", id: 1, result: [1, 2, 3] });
      const result = await odooExecuteKw(config, 7, "res.partner", "search", [[["name", "=", "Acme"]]], { limit: 1 });
      expect(result).toEqual([1, 2, 3]);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.params.service).toBe("object");
      expect(body.params.method).toBe("execute_kw");
      expect(body.params.args).toEqual(["mydb", 7, "fake-key", "res.partner", "search", [[["name", "=", "Acme"]]], { limit: 1 }]);
    });
  });

  describe("findOrCreateOdooPartner", () => {
    it("returns the existing partner id when a name match is found, without creating a duplicate", async () => {
      mockFetchOnce({ jsonrpc: "2.0", id: 1, result: [42] });
      const partnerId = await findOrCreateOdooPartner(config, 7, { name: "Jarir Bookstore HQ" });
      expect(partnerId).toBe(42);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.params.args[4]).toBe("search"); // no "create" call should have happened
    });

    it("creates a new partner when no match is found", async () => {
      let call = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) return { ok: true, status: 200, json: async () => ({ result: [] }) }; // search: no match
        return { ok: true, status: 200, json: async () => ({ result: [99] }) }; // create: new id
      }) as any;

      const partnerId = await findOrCreateOdooPartner(config, 7, { name: "New Customer Co." });
      expect(partnerId).toBe(99);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("pushInvoiceToOdoo", () => {
    it("creates the invoice with the documented account.move shape, then posts it", async () => {
      let call = 0;
      const calls: any[] = [];
      global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        call++;
        calls.push(JSON.parse(opts.body));
        if (call === 1) return { ok: true, status: 200, json: async () => ({ result: [55] }) }; // create
        return { ok: true, status: 200, json: async () => ({ result: true }) }; // action_post
      }) as any;

      const moveId = await pushInvoiceToOdoo(config, 7, {
        partnerId: 42,
        invoiceNumber: "INV-TEST-001",
        invoiceDate: "2026-01-15",
        description: "Order ORD-TEST-001 — 2 × 19L bottles",
        quantity: 2,
        priceUnit: 8,
      });

      expect(moveId).toBe(55);
      expect(calls[0].params.args[4]).toBe("create");
      const createVals = calls[0].params.args[5][0][0];
      expect(createVals.move_type).toBe("out_invoice");
      expect(createVals.partner_id).toBe(42);
      expect(createVals.ref).toBe("INV-TEST-001");
      expect(createVals.invoice_line_ids[0][2].quantity).toBe(2);
      expect(createVals.invoice_line_ids[0][2].price_unit).toBe(8);

      expect(calls[1].params.args[4]).toBe("action_post");
      expect(calls[1].params.args[5]).toEqual([[55]]);
    });

    it("includes tax_ids on the line when a default tax id is configured", async () => {
      const calls: any[] = [];
      global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        calls.push(JSON.parse(opts.body));
        return calls.length === 1
          ? { ok: true, status: 200, json: async () => ({ result: [1] }) }
          : { ok: true, status: 200, json: async () => ({ result: true }) };
      }) as any;

      await pushInvoiceToOdoo(config, 7, {
        partnerId: 1,
        invoiceNumber: "INV-002",
        invoiceDate: "2026-01-01",
        description: "test",
        quantity: 1,
        priceUnit: 10,
        taxId: 123,
      });

      const createVals = calls[0].params.args[5][0][0];
      expect(createVals.invoice_line_ids[0][2].tax_ids).toEqual([[6, 0, [123]]]);
    });
  });
});
