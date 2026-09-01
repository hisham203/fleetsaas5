import { randomUUID } from "crypto";

// Drizzle has no DB-side default id generator for SQLite text PKs (unlike
// Prisma's @default(cuid())), so IDs are generated in application code.
export function genId() {
  return randomUUID();
}

// Simple sequential-looking IDs for demo purposes.
// In production, generate these via a tenant-scoped counter table to avoid collisions.
export function genNumber(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${stamp}-${rand}`;
}

export const VAT_RATE = 0.15; // Saudi VAT

export function calcInvoiceTotals(subtotal: number, vatRate = VAT_RATE) {
  const vatAmount = Math.round(subtotal * vatRate * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  return { vatAmount, total };
}

// Demo tenant — Phase 1 ships single-tenant-in-practice even though the schema
// is multi-tenant-ready (BR-01). Swap this for real session/auth-derived tenantId.
export const DEMO_TENANT_SLUG = "demo-water-co";
