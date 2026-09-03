import { db } from "../db/client";
import { erpConnections, invoices, customers } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { odooAuthenticate, findOrCreateOdooPartner, pushInvoiceToOdoo, type OdooConnectionConfig } from "./odoo";

export async function getErpConnection(tenantId: string) {
  return db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });
}

function toOdooConfig(connection: { baseUrl: string; database: string; username: string; apiKey: string }): OdooConnectionConfig {
  return { baseUrl: connection.baseUrl, database: connection.database, username: connection.username, apiKey: connection.apiKey };
}

export type SyncResult = { success: boolean; error?: string; odooInvoiceId?: number };

// Syncs a single invoice to Odoo: finds or creates the customer as a
// res.partner, then creates and posts the invoice as an account.move.
// Idempotent — an invoice that already has an erpExternalId is treated as
// already synced and returns success immediately without calling Odoo
// again, so re-running "sync all" is always safe.
export async function syncInvoiceToOdoo(tenantId: string, invoiceId: string): Promise<SyncResult> {
  const connection = await getErpConnection(tenantId);
  if (!connection || !connection.enabled) {
    return { success: false, error: "ERP sync is not configured for this tenant yet" };
  }

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)),
    with: { customer: true, order: true },
  });
  if (!invoice) return { success: false, error: "Invoice not found" };
  if (invoice.erpExternalId) return { success: true, odooInvoiceId: Number(invoice.erpExternalId) };
  // A2 safety guard (Task E): a monthly consolidated invoice has no
  // single order — this function's whole design (one order = one Odoo
  // line item's description/quantity/price) is fundamentally
  // incompatible with a multi-order invoice. Rejecting clearly now is
  // the correct scope for this task; building real multi-line ERP sync
  // is separate, later work, not attempted here.
  if (!invoice.order) {
    return { success: false, error: "ERP sync for monthly consolidated invoices is not yet implemented" };
  }

  const config = toOdooConfig(connection);

  try {
    const uid = await odooAuthenticate(config);

    let partnerId = invoice.customer.erpExternalId ? Number(invoice.customer.erpExternalId) : null;
    if (!partnerId) {
      partnerId = await findOrCreateOdooPartner(config, uid, {
        name: invoice.customer.name,
        phone: invoice.customer.phone,
        email: invoice.customer.loginEmail,
      });
      await db.update(customers).set({ erpExternalId: String(partnerId) }).where(eq(customers.id, invoice.customer.id));
    }

    const odooInvoiceId = await pushInvoiceToOdoo(config, uid, {
      partnerId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.createdAt.toISOString().slice(0, 10),
      description: `Order ${invoice.order.orderNumber} — ${invoice.order.qtyOrdered} × ${invoice.order.bottleSizeLtr}L bottles`,
      quantity: invoice.order.qtyOrdered,
      priceUnit: invoice.order.pricePerBottle,
      taxId: connection.defaultTaxId ? Number(connection.defaultTaxId) : undefined,
    });

    await db
      .update(invoices)
      .set({ erpExternalId: String(odooInvoiceId), erpSyncedAt: new Date(), erpSyncError: null })
      .where(eq(invoices.id, invoice.id));

    return { success: true, odooInvoiceId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown ERP sync error";
    await db.update(invoices).set({ erpSyncError: message }).where(eq(invoices.id, invoice.id));
    return { success: false, error: message };
  }
}

export type BulkSyncResult = { total: number; synced: number; failed: number; errors: { invoiceNumber: string; error: string }[] };

// Syncs every not-yet-synced invoice for the tenant, sequentially (not in
// parallel — Odoo's JSON-RPC endpoint authenticates per call, and hammering
// it with concurrent requests is more likely to hit rate limits than save
// meaningful time for what's expected to be a modest invoice volume).
export async function syncAllUnsyncedInvoices(tenantId: string): Promise<BulkSyncResult> {
  const unsynced = await db.query.invoices.findMany({
    where: and(eq(invoices.tenantId, tenantId), isNull(invoices.erpExternalId)),
  });

  const result: BulkSyncResult = { total: unsynced.length, synced: 0, failed: 0, errors: [] };

  for (const invoice of unsynced) {
    const outcome = await syncInvoiceToOdoo(tenantId, invoice.id);
    if (outcome.success) {
      result.synced++;
    } else {
      result.failed++;
      result.errors.push({ invoiceNumber: invoice.invoiceNumber, error: outcome.error ?? "Unknown error" });
    }
  }

  return result;
}
