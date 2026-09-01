"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type SessionInfo = {
  type: "USER" | "CUSTOMER";
  id: string;
  tenantId: string;
  effectiveTenantId?: string; // Company Switcher: the tenant currently being viewed, if different from tenantId
  isPlatformAdmin?: boolean;
  name: string;
  email: string | null;
  role: "ADMIN" | "DISPATCHER" | "DRIVER" | "CUSTOMER";
  driverProfileId?: string | null;
};

// Shared client-side guard for pages that require a specific role. Redirects
// to /login if there's no session, or to / (which itself redirects to the
// right place) if the session exists but doesn't have an allowed role —
// this keeps a Driver from landing on /admin by typing the URL directly.
//
// Note: this is a UX-level guard, not the security boundary — every API
// route independently re-checks the session server-side (see lib/auth.ts),
// so this hook being client-side JS doesn't create a bypassable gap.
export function useRequireSession(allowedRoles: SessionInfo["role"][]) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionInfo | null) => {
        if (cancelled) return;
        if (!data) {
          router.replace("/login");
          return;
        }
        if (!allowedRoles.includes(data.role)) {
          router.replace("/");
          return;
        }
        setSession(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, loading };
}

export async function logout(router: ReturnType<typeof useRouter>) {
  await fetch("/api/auth/logout", { method: "POST" });
  router.replace("/login");
}
