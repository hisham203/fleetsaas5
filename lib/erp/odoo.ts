// BR-19: ERP/Accounting Sync — Odoo integration.
//
// Odoo's external API is documented at:
//   https://www.odoo.com/documentation/17.0/developer/reference/external_api.html
// It exposes the same "service/method/args" contract over both XML-RPC and
// JSON-RPC. This client uses JSON-RPC (POST to <baseUrl>/jsonrpc with a
// JSON-RPC 2.0 envelope) since it needs no XML parsing — just fetch and
// JSON, which keeps this dependency-free. The request/response shapes here
// match Odoo's documented contract and have been consistent across Odoo
// versions for years, but this specific client has NOT been run against a
// live Odoo server (no Odoo instance is reachable from this environment —
// see the README's ERP sync section). Test it against your real instance
// via POST /api/erp/connection/test before relying on it.

export type OdooConnectionConfig = {
  baseUrl: string; // e.g. https://mycompany.odoo.com (no trailing slash)
  database: string;
  username: string;
  apiKey: string;
};

class OdooError extends Error {}

let requestCounter = 0;
function nextRequestId(): number {
  requestCounter = (requestCounter + 1) % 1_000_000;
  return requestCounter;
}

async function jsonRpcCall(baseUrl: string, service: string, method: string, args: unknown[]): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}/jsonrpc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: nextRequestId(),
    }),
  });

  if (!res.ok) {
    throw new OdooError(`Odoo returned HTTP ${res.status} — check the base URL is reachable and correct`);
  }

  const body = (await res.json()) as { result?: unknown; error?: { message?: string; data?: { message?: string } } };
  if (body.error) {
    const message = body.error.data?.message ?? body.error.message ?? "Unknown Odoo error";
    throw new OdooError(message);
  }
  return body.result;
}

// Authenticates against Odoo's `common` service and returns the numeric
// user id Odoo assigns for this session — required for every subsequent
// execute_kw call. Odoo's `authenticate` returns `false` (not an error) on
// bad credentials, so that's checked explicitly here.
export async function odooAuthenticate(config: OdooConnectionConfig): Promise<number> {
  const result = await jsonRpcCall(config.baseUrl, "common", "authenticate", [
    config.database,
    config.username,
    config.apiKey,
    {},
  ]);
  if (result === false || result == null) {
    throw new OdooError("Authentication failed — check database name, username, and API key");
  }
  return result as number;
}

// Generic model method call — the same execute_kw contract every Odoo
// integration uses for reading/writing any model (res.partner, account.move,
// product.product, etc).
export async function odooExecuteKw(
  config: OdooConnectionConfig,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  return jsonRpcCall(config.baseUrl, "object", "execute_kw", [
    config.database,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

export type OdooCustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
};

// Looks up an existing res.partner by exact name match; creates one if not
// found. A real integration would want a more robust match (e.g. by a
// custom external-id field) — exact name match is a reasonable starting
// point given Odoo has no concept of our internal customer IDs to match on
// without a custom field added to res.partner first.
export async function findOrCreateOdooPartner(
  config: OdooConnectionConfig,
  uid: number,
  customer: OdooCustomerInput
): Promise<number> {
  const existing = (await odooExecuteKw(config, uid, "res.partner", "search", [[["name", "=", customer.name]]], {
    limit: 1,
  })) as number[];

  if (existing && existing.length > 0) return existing[0];

  const created = (await odooExecuteKw(config, uid, "res.partner", "create", [
    [
      {
        name: customer.name,
        ...(customer.phone ? { phone: customer.phone } : {}),
        ...(customer.email ? { email: customer.email } : {}),
      },
    ],
  ])) as number | number[];

  return Array.isArray(created) ? created[0] : created;
}

export type OdooInvoiceInput = {
  partnerId: number;
  invoiceNumber: string; // stored in Odoo's `ref` field for reconciliation
  invoiceDate: string; // YYYY-MM-DD
  description: string;
  quantity: number;
  priceUnit: number;
  taxId?: number; // Odoo account.tax id — omit to push untaxed and let Odoo/partner fiscal position decide
};

// Creates a customer invoice (account.move, move_type "out_invoice") with a
// single line item, then posts it (action_post) so it's a real invoice in
// Odoo rather than a draft. Returns the created move's id.
export async function pushInvoiceToOdoo(config: OdooConnectionConfig, uid: number, input: OdooInvoiceInput): Promise<number> {
  const lineVals: Record<string, unknown> = {
    name: input.description,
    quantity: input.quantity,
    price_unit: input.priceUnit,
  };
  if (input.taxId != null) {
    lineVals.tax_ids = [[6, 0, [input.taxId]]]; // Odoo's "replace all" command for many2many fields
  }

  const created = (await odooExecuteKw(config, uid, "account.move", "create", [
    [
      {
        move_type: "out_invoice",
        partner_id: input.partnerId,
        invoice_date: input.invoiceDate,
        ref: input.invoiceNumber,
        invoice_line_ids: [[0, 0, lineVals]],
      },
    ],
  ])) as number | number[];

  const moveId = Array.isArray(created) ? created[0] : created;
  await odooExecuteKw(config, uid, "account.move", "action_post", [[moveId]]);
  return moveId;
}
