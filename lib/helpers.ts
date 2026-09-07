import { randomUUID } from "crypto";
import { z } from "zod";

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

// Milestone AC, Part 2 — client-side counterpart to the API fix above.
// Every Z.2 CRUD form's save() handler did
// `typeof data.error === "string" ? data.error : "Failed to save"` —
// but a Zod validation failure returns `{ error: parsed.error.flatten() }`,
// an OBJECT, not a string, so every 400 response silently collapsed
// into the generic message, hiding the real cause from the user (the
// exact reported "Failed to save" bug). Used by every form's save()
// handler so this class of bug can't quietly recur.
export function extractErrorMessage(data: any): string {
  if (typeof data?.error === "string") return data.error;
  const fieldErrors = data?.error?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") {
    const firstField = Object.keys(fieldErrors)[0];
    const firstMessage = firstField ? fieldErrors[firstField]?.[0] : undefined;
    if (firstMessage) return `${firstField}: ${firstMessage}`;
  }
  return "Failed to save";
}

// Milestone AC, Part 2 — shared fix for a real, reported production bug:
// z.string().email().optional() only exempts `undefined` from the
// .email() format check, not an empty string. Every UI form on this
// project (SupplierForm, WorkshopForm, ...) initializes an optional
// email/URL field to "" and sends it as-is when left blank — so a
// literal z.string().email().optional() rejects that blank field with
// a 400, which the UI's own generic error handling then collapsed into
// an unhelpful "Failed to save" (see the Part 2 fix to that too).
// Reused everywhere an optional email field exists, so this exact class
// of bug can't quietly recur in a route this helper wasn't used in.
export function optionalEmailSchema() {
  return z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, { message: "Invalid email" });
}

export function optionalUrlSchema() {
  return z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine((v) => v === undefined || z.string().url().safeParse(v).success, { message: "Invalid URL" });
}

// Milestone Y, Part 5 — expenseClaims has no reference/sequence column
// (confirmed by direct schema inspection), and this is a display-only
// need, not a billing-relevant sequential number like invoiceNumber/
// orderNumber (which ARE stored at insert time, unlike this). A
// deterministic derivation from the expense's own existing, immutable
// id + createdAt avoids a migration entirely: the same expense always
// produces the same reference, and it's unique enough for a tenant's UI
// display/search purposes (UUID entropy), without claiming to be a true
// gapless sequential business number — that would require a schema
// proposal (a tenant-scoped counter table/column), which this milestone
// explicitly does not implement.
export function expenseRef(expense: { id: string; createdAt: Date | string }): string {
  const year = new Date(expense.createdAt).getFullYear();
  const shortId = expense.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `EXP-${year}-${shortId}`;
}

export function calcInvoiceTotals(subtotal: number, vatRate = VAT_RATE) {
  const vatAmount = Math.round(subtotal * vatRate * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  return { vatAmount, total };
}

// Demo tenant — Phase 1 ships single-tenant-in-practice even though the schema
// is multi-tenant-ready (BR-01). Swap this for real session/auth-derived tenantId.
export const DEMO_TENANT_SLUG = "demo-water-co";
