export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants, users, warehouses, inventoryItems, numberingSeries } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { hashPassword, createSession, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { logSignupSuccess, logSignupFailure, logRateLimitHit } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { RECOMMENDED_NUMBERING_DEFAULTS } from "@/lib/numberingDefaults";

// Signup creates a real tenant + admin + warehouse per call — a more
// expensive and more abuse-prone operation than a login attempt, so this
// gets a tighter, longer window: 5 signups per hour per IP.
const SIGNUP_IP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

const signupSchema = z.object({
  companyName: z.string().min(1),
  sector: z.string().default("WATER_DELIVERY"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  password: z.string().min(6),
  warehouseName: z.string().min(1),
  warehouseAddress: z.string().min(1),
  warehouseLat: z.number(),
  warehouseLng: z.number(),
});

// Multi-tenant onboarding: one call creates a brand-new, fully isolated
// company — tenant row, its first Admin user, a default warehouse with
// starter inventory, and all recommended numbering series.
// The numbering series bootstrap runs inside the same transaction so that
// a functional tenant is never created without the configuration required
// for core workflows (expenses, contracts, etc.). ON CONFLICT DO NOTHING
// is safe inside a Postgres transaction — it uses the same connection/tx
// and the unique constraint on (tenantId, entityType) guarantees
// idempotency without aborting the transaction.
//
// EXP-001 root cause fixed: pre-fix signup omitted numbering bootstrap
// entirely. Post-fix: bootstrap is atomic with tenant creation.
// Canonical series list lives in lib/numberingDefaults.ts — consumed here
// and by Settings → Apply Recommended so both surfaces are always in sync.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipCheck = checkRateLimit(`signup:ip:${ip}`, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS);
  if (!ipCheck.allowed) {
    logRateLimitHit({ path: "/api/auth/signup", ip, limitType: "ip", retryAfterSeconds: ipCheck.retryAfterSeconds });
    logSignupFailure({ path: "/api/auth/signup", ip, reason: "rate_limited" });
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } }
    );
  }

  const body = await req.json();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    logSignupFailure({ path: "/api/auth/signup", ip, reason: "validation_error" });
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, data.adminEmail) });
  if (existing) {
    logSignupFailure({ path: "/api/auth/signup", ip, reason: "email_already_registered" });
    return NextResponse.json({ error: "That email is already registered" }, { status: 409 });
  }

  const tenantId = genId();
  const userId = genId();
  const warehouseId = genId();
  const passwordHash = await hashPassword(data.password);

  // All tenant bootstrap is atomic — either the complete functional tenant
  // exists (tenant + admin + warehouse + inventory + numbering series) or
  // nothing is committed. The driver is node-postgres via Drizzle; tx.insert
  // on the same tx object is safe and tested on multiple tables above.
  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: data.companyName, sector: data.sector });
    await tx
      .insert(users)
      .values({ id: userId, tenantId, name: data.adminName, email: data.adminEmail, passwordHash, role: "ADMIN" });
    await tx.insert(warehouses).values({
      id: warehouseId,
      tenantId,
      name: data.warehouseName,
      address: data.warehouseAddress,
      lat: data.warehouseLat,
      lng: data.warehouseLng,
      isDefault: true,
    });
    await tx.insert(inventoryItems).values([
      { id: genId(), tenantId, warehouseId, itemName: "19L Bottle - Full", quantity: 0, unit: "bottle" },
      { id: genId(), tenantId, warehouseId, itemName: "19L Bottle - Empty", quantity: 0, unit: "bottle" },
    ]);

    // Recommended numbering series — sourced from lib/numberingDefaults.ts.
    // ON CONFLICT DO NOTHING: the unique constraint on (tenantId, entityType)
    // makes this safe for re-entrant calls (e.g., tests). Since tenantId is
    // brand new in this transaction, conflicts are impossible in normal
    // production usage; the clause only guards against unusual concurrent
    // signups with the same generated tenantId (practically impossible but
    // structurally safe).
    const seriesValues = RECOMMENDED_NUMBERING_DEFAULTS.map((s) => ({
      id: genId(),
      tenantId,
      entityType: s.entityType,
      seriesCode: s.seriesCode,
      displayName: s.displayName,
      prefix: s.prefix,
      seriesSegment: "06",
      separator: "",
      paddingLength: 3,
      nextNumber: 1,
      resetPolicy: "NEVER",
      includeYear: false,
      includeMonth: false,
      status: "ACTIVE",
    }));
    await tx.insert(numberingSeries).values(seriesValues).onConflictDoNothing();
  });

  const { token, expiresAt } = await createSession("USER", userId);
  logSignupSuccess({ path: "/api/auth/signup", ip, tenantId, userId });
  const res = NextResponse.json({ role: "ADMIN", name: data.adminName }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
  return res;
}
