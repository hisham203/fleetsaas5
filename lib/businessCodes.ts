// Milestone AF — shared business-code handling for every entity that
// carries a manual-or-generated code (supplierCode, workshopCode,
// itemCode, ...). One implementation of the proven AE Supplier pattern,
// used by all converted entities, so the manual-code rules and the
// allocate-on-blank behavior can't drift between routes.

import { allocateNextNumber, NoActiveSeriesError } from "./numbering";

// ---------- Part 3: manual code validation ----------
// A manual business code must be a trimmed string of 3–30 characters
// using only letters, digits, hyphen, underscore. Leading zeros are
// preserved because this never coerces to a number. One- and
// two-character codes are rejected — a bare "V" or "AB" is a prefix,
// not a code (the exact production case this milestone fixes).
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

export function validateBusinessCode(raw: unknown, label = "Code"): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: `${label} must be a string` };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: `${label} is required` };
  if (/\s/.test(value)) return { ok: false, error: `${label} cannot contain spaces` };
  if (value.length < 3) return { ok: false, error: `${label} must be at least 3 characters — a one- or two-letter value like "${value}" is a prefix, not a code` };
  if (value.length > 30) return { ok: false, error: `${label} must be 30 characters or fewer` };
  if (!CODE_PATTERN.test(value)) return { ok: false, error: `${label} may only contain letters, numbers, hyphen, and underscore` };
  return { ok: true, value };
}

// ---------- Part 4: field → numbering entityType mapping ----------
// Lives in lib/numbering.ts (client-safe, no DB import) so the Settings
// page can render coverage without pulling the server-only allocator —
// and therefore `pg` — into the browser bundle. Re-exported here for
// server-side callers.
export { CODE_FIELD_ENTITY_MAP } from "./numbering";
export type { CodeFieldStatus } from "./numbering";

// ---------- Shared resolve: manual → validate; blank → allocate ----------
export type ResolveCodeResult =
  | { ok: true; code: string; allocated: false }
  | { ok: true; code: string; allocated: true; seriesId: string }
  | { ok: false; status: 400 | 409; error: string };

export async function resolveEntityCode(params: {
  tenantId: string;
  entityType: string;
  entityLabel: string; // e.g. "supplier", used in messages
  codeLabel: string; // e.g. "Supplier code"
  provided: string | undefined | null;
  isDuplicate: (code: string) => Promise<boolean>;
}): Promise<ResolveCodeResult> {
  const trimmed = typeof params.provided === "string" ? params.provided.trim() : "";

  if (trimmed.length > 0) {
    const v = validateBusinessCode(trimmed, params.codeLabel);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    if (await params.isDuplicate(v.value)) {
      return { ok: false, status: 409, error: `A ${params.entityLabel} with code "${v.value}" already exists for this tenant` };
    }
    return { ok: true, code: v.value, allocated: false };
  }

  try {
    const allocated = await allocateNextNumber({ tenantId: params.tenantId, entityType: params.entityType });
    return { ok: true, code: allocated.generatedNumber, allocated: true, seriesId: allocated.seriesId };
  } catch (err) {
    if (err instanceof NoActiveSeriesError) {
      const pretty = params.entityLabel.charAt(0).toUpperCase() + params.entityLabel.slice(1);
      return { ok: false, status: 400, error: `Configure an active ${pretty} numbering series in Settings, or enter a valid ${params.entityLabel} code.` };
    }
    throw err;
  }
}

// After the entity row is inserted, link the ledger entry the allocation
// already wrote back to that real record. Best-effort enrichment; the
// number itself was safely allocated and logged before the row existed.
export async function linkLedgerToRecord(params: { tenantId: string; seriesId: string; generatedNumber: string; referenceTable: string; referenceId: string }) {
  const { db } = await import("./db/client");
  const { numberingSequenceLedger } = await import("./db/schema");
  const { eq, and } = await import("drizzle-orm");
  await db
    .update(numberingSequenceLedger)
    .set({ referenceTable: params.referenceTable, referenceId: params.referenceId })
    .where(and(eq(numberingSequenceLedger.tenantId, params.tenantId), eq(numberingSequenceLedger.seriesId, params.seriesId), eq(numberingSequenceLedger.generatedNumber, params.generatedNumber)));
}
