export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { users, customers } from "@/lib/db/schema";
import { verifyPassword, createSession, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { logLoginSuccess, logLoginFailure, logRateLimitHit } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Rate limits, checked before any password verification work happens:
//   - by IP: 10 attempts / 15 minutes — bounds brute force from one source
//   - by email: 5 attempts / 15 minutes — bounds targeted credential
//     stuffing against one specific account even if the attacker rotates
//     IPs. Checked in addition to, not instead of, the IP limit.
// Every attempt counts toward both windows regardless of outcome — see
// lib/rateLimit.ts for why counting successes too is the safer default.
const LOGIN_IP_LIMIT = 10;
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many login attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

// Checks internal users (Admin/Dispatcher/Driver) by email first, then B2B
// customer portal logins by loginEmail. Same endpoint for both so the login
// page doesn't need to ask "which kind of account are you" up front.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const ip = getClientIp(req);
  const ipCheck = checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  if (!ipCheck.allowed) {
    logRateLimitHit({ path: "/api/auth/login", ip, limitType: "ip", retryAfterSeconds: ipCheck.retryAfterSeconds });
    logLoginFailure({ path: "/api/auth/login", ip, reason: "rate_limited_ip" });
    return rateLimitedResponse(ipCheck.retryAfterSeconds);
  }

  const emailCheck = checkRateLimit(`login:email:${email.toLowerCase()}`, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
  if (!emailCheck.allowed) {
    logRateLimitHit({ path: "/api/auth/login", ip, limitType: "email", retryAfterSeconds: emailCheck.retryAfterSeconds });
    logLoginFailure({ path: "/api/auth/login", ip, reason: "rate_limited_email" });
    return rateLimitedResponse(emailCheck.retryAfterSeconds);
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (user?.passwordHash) {
    const ok = await verifyPassword(password, user.passwordHash);
    if (ok) {
      const { token, expiresAt } = await createSession("USER", user.id);
      logLoginSuccess({ path: "/api/auth/login", ip, userId: user.id, role: user.role });
      const res = NextResponse.json({ role: user.role, name: user.name });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        expires: expiresAt,
        path: "/",
      });
      return res;
    }
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.loginEmail, email) });
  if (customer?.passwordHash) {
    const ok = await verifyPassword(password, customer.passwordHash);
    if (ok) {
      const { token, expiresAt } = await createSession("CUSTOMER", customer.id);
      logLoginSuccess({ path: "/api/auth/login", ip, userId: customer.id, role: "CUSTOMER" });
      const res = NextResponse.json({ role: "CUSTOMER", name: customer.name });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        expires: expiresAt,
        path: "/",
      });
      return res;
    }
  }

  logLoginFailure({ path: "/api/auth/login", ip, reason: "invalid_credentials" });
  return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
}
