import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { db } from "./db/client";
import { sessions, users, customers, platformAdminTenantGrants } from "./db/schema";
import { eq, and } from "drizzle-orm";

export const SESSION_COOKIE = "session_token";
// Company Switcher: a SEPARATE cookie from the session token, only ever
// meaningful for a platform admin. Deliberately not part of the session
// row/token itself — it's just a hint of "which tenant would you like to
// view", and every read of it is re-validated against the database on
// every single request (see getSessionFromRequest below). A non-platform-
// admin's effective tenant is always their own, full stop, regardless of
// what this cookie contains — client-supplied data is never trusted to
// select a tenant on its own.
export const SWITCH_TENANT_COOKIE = "active_tenant_id";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export type Session =
  | { type: "USER"; token: string; expiresAt: Date; user: typeof users.$inferSelect; effectiveTenantId: string }
  | { type: "CUSTOMER"; token: string; expiresAt: Date; customer: typeof customers.$inferSelect };

export async function createSession(subjectType: "USER" | "CUSTOMER", subjectId: string) {
  const token = randomUUID() + randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({
    id: randomUUID(),
    subjectType,
    subjectId,
    token,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

// Company Switcher authorization check — a platform admin may switch into
// their own home tenant (always allowed) or any tenant they have an
// explicit grant row for. Nobody else may switch into anything. This is
// called fresh on every request that resolves a session, and again inside
// the switch endpoint itself before it sets the cookie — never cached,
// never trusted from a prior check.
export async function isAuthorizedForTenant(user: typeof users.$inferSelect, tenantId: string): Promise<boolean> {
  if (!user.isPlatformAdmin) return tenantId === user.tenantId;
  if (tenantId === user.tenantId) return true;
  const grant = await db.query.platformAdminTenantGrants.findFirst({
    where: and(eq(platformAdminTenantGrants.userId, user.id), eq(platformAdminTenantGrants.tenantId, tenantId)),
  });
  return !!grant;
}

export async function getSessionFromToken(token: string | undefined | null, requestedTenantId?: string | null): Promise<Session | null> {
  if (!token) return null;
  const session = await db.query.sessions.findFirst({ where: eq(sessions.token, token) });
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    // expired — clean it up lazily
    await deleteSession(token).catch(() => {});
    return null;
  }

  if (session.subjectType === "USER") {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.subjectId) });
    if (!user) return null;

    // Company Switcher: resolve the effective tenant ONCE here, so every
    // existing route — which already calls getSessionTenantId() and has
    // done so since before this feature existed — automatically becomes
    // switch-aware with no route-by-route changes. requestedTenantId comes
    // from a cookie in getSessionFromRequest below; it is re-validated
    // here against the database every time, never trusted at face value.
    let effectiveTenantId = user.tenantId;
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      const authorized = await isAuthorizedForTenant(user, requestedTenantId);
      if (authorized) effectiveTenantId = requestedTenantId;
      // If not authorized, silently fall back to the user's own home
      // tenant rather than erroring the whole request — a stale or
      // tampered cookie should degrade to "you see your own company",
      // never to a 500 or, worse, a leaked cross-tenant view.
    }

    return { type: "USER", token, expiresAt: session.expiresAt, user, effectiveTenantId };
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, session.subjectId) });
  if (!customer) return null;
  return { type: "CUSTOMER", token, expiresAt: session.expiresAt, customer };
}

export async function getSessionFromRequest(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const requestedTenantId = req.cookies.get(SWITCH_TENANT_COOKIE)?.value;
  return getSessionFromToken(token, requestedTenantId);
}

// Convenience guard for API routes. Returns the session, or null and the
// caller should respond 401/403. Kept simple (no thrown exceptions) so each
// route stays readable: `const session = await requireRole(req, ["ADMIN"]);
// if (!session) return unauthorized();`
// Multi-tenant hardening: every route should derive tenantId from the
// session, never trust a client-supplied tenantId query/body param. This is
// the helper that makes that a one-liner everywhere — and, since the
// Company Switcher, this returns the SWITCHED tenant for an authorized
// platform admin, or the user's own tenant for everyone else. Returns null
// only if called with no session (callers should already have checked
// hasRole first).
export function getSessionTenantId(session: Session | null): string | null {
  if (!session) return null;
  return session.type === "USER" ? session.effectiveTenantId : session.customer.tenantId;
}

export function hasRole(session: Session | null, roles: Array<"ADMIN" | "DISPATCHER" | "DRIVER" | "CUSTOMER">) {
  if (!session) return false;
  if (session.type === "CUSTOMER") return roles.includes("CUSTOMER");
  return roles.includes(session.user.role as "ADMIN" | "DISPATCHER" | "DRIVER");
}
