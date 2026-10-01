"use client";
/**
 * /admin/settings — COMPATIBILITY REDIRECT
 *
 * This page has been superseded by the canonical Administration domain.
 * All functionality is available at:
 *   /administration/numbering  — Numbering & Sequences
 *   /administration/users      — Users & Access
 *   /administration/roles      — Roles & Permissions
 *   /administration/organization — Organization
 *
 * Deterministic ?tab= routing preserves historical deep links.
 * Cannot loop — /administration/* routes have no redirects back here.
 */
import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RedirectInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const tab = params.get("tab");
    if (tab === "users" || tab === "access") {
      router.replace("/administration/users");
    } else if (tab === "roles" || tab === "permissions") {
      router.replace("/administration/roles");
    } else if (tab === "org" || tab === "organization") {
      router.replace("/administration/organization");
    } else {
      router.replace("/administration/numbering");
    }
  }, [router, params]);

  return null;
}

export default function AdminSettingsRedirect() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center">
      <p className="text-steel text-sm">Redirecting to Administration…</p>
      <Suspense>
        <RedirectInner />
      </Suspense>
    </div>
  );
}
