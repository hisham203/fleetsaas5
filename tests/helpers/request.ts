import { NextRequest } from "next/server";

// Builds a NextRequest against a fake localhost origin, since route handlers
// are called directly in-process here (no real HTTP server involved) — see
// the "How testing works" note in tests/README.md-equivalent section of the
// main README.
export function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers["cookie"] = opts.cookie;

  return new NextRequest(new Request(`http://localhost${url}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }));
}

// Pulls any named cookie's value out of a Set-Cookie response header.
export function extractCookie(res: Response, name: string): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : "";
}

// Pulls the session cookie out of a login/signup response so it can be
// attached to subsequent authenticated requests in the same test.
export function extractSessionCookie(res: Response): string {
  return extractCookie(res, "session_token");
}

// Combines multiple `name=value` cookie strings into one Cookie header
// value, e.g. for tests that need both the session and an active_tenant_id
// override attached to the same request.
export function combineCookies(...cookies: string[]): string {
  return cookies.filter(Boolean).join("; ");
}

export async function loginAs(email: string, password: string): Promise<string> {
  const { POST } = await import("@/app/api/auth/login/route");
  const res = await POST(makeRequest("/api/auth/login", { method: "POST", body: { email, password } }));
  if (res.status !== 200) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
  }
  return extractSessionCookie(res);
}
