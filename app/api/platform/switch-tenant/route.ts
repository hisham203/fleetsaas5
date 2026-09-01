export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { getSessionFromRequest, isAuthorizedForTenant, SWITCH_TENANT_COOKIE } from "@/lib/auth";
import { logTenantSwitchSuccess, logTenantSwitchFailure } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";

const switchSchema = z.object({ tenantId: z.string() });

// Company Switcher — the only place the active_tenant_id cookie is ever
// set. Authorization is re-checked here from scratch (never trusts that
// the UI only offered authorized options) before the cookie is written,
// and getSessionFromRequest (lib/auth.ts) re-checks it AGAIN on every
// subsequent request — a tampered or stale cookie can never grant access
// beyond what isAuthorizedForTenant actually allows at read time.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.type !== "USER") {
    logTenantSwitchFailure({ path: "/api/platform/switch-tenant", reason: "not_authenticated" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isPlatformAdmin) {
    logTenantSwitchFailure({ path: "/api/platform/switch-tenant", userId: session.user.id, reason: "not_platform_admin" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    logTenantSwitchFailure({ path: "/api/platform/switch-tenant", userId: session.user.id, reason: "invalid_request" });
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const authorized = await isAuthorizedForTenant(session.user, parsed.data.tenantId);
  if (!authorized) {
    logTenantSwitchFailure({
      path: "/api/platform/switch-tenant",
      userId: session.user.id,
      attemptedTenantId: parsed.data.tenantId,
      reason: "not_authorized_for_tenant",
    });
    return NextResponse.json({ error: "You are not authorized to access this company" }, { status: 403 });
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, parsed.data.tenantId) });
  if (!tenant) {
    logTenantSwitchFailure({
      path: "/api/platform/switch-tenant",
      userId: session.user.id,
      attemptedTenantId: parsed.data.tenantId,
      reason: "tenant_not_found",
    });
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  logTenantSwitchSuccess({
    path: "/api/platform/switch-tenant",
    userId: session.user.id,
    tenantId: session.user.tenantId,
    effectiveTenantId: tenant.id,
  });

  const res = NextResponse.json({ id: tenant.id, name: tenant.name, sector: tenant.sector });
  // Switching back to the user's own home tenant is just "clear the
  // override" — deleting the cookie rather than setting it to the home id
  // keeps getSessionFromRequest's logic simple (no cookie = home tenant).
  if (parsed.data.tenantId === session.user.tenantId) {
    res.cookies.delete(SWITCH_TENANT_COOKIE);
  } else {
    res.cookies.set(SWITCH_TENANT_COOKIE, parsed.data.tenantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Intentionally no explicit `expires` — this is a per-session UI
      // preference, not a credential; letting it ride as a session cookie
      // (cleared when the browser closes) means a shared/public machine
      // doesn't stay parked on a switched-into company indefinitely.
    });
  }
  return res;
}
