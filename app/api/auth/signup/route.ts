export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants, users, warehouses, inventoryItems } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { hashPassword, createSession, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { logSignupSuccess, logSignupFailure, logRateLimitHit } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
// company — tenant row, its first Admin user, and a default warehouse with
// starter inventory so the new tenant isn't staring at an empty Inventory
// tab. Every subsequent request is scoped to this tenant via the session
// (see lib/auth.ts getSessionTenantId) — the client never gets to choose
// which tenant it's operating on.
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
