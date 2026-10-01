"use client";
/**
 * /settings/access — COMPATIBILITY REDIRECT
 *
 * The full RBAC management workspace is now at the canonical Administration domain:
 *   /settings/access            → /administration/users   (default)
 *   /settings/access?tab=users  → /administration/users
 *   /settings/access?tab=roles  → /administration/roles
 *   /settings/access?tab=matrix → /administration/roles
 *   /settings/access?tab=audit  → /administration/roles
 *
 * Bookmarked links preserved. Cannot loop.
 */
import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RedirectInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const tab = params.get("tab");
    if (tab === "roles" || tab === "matrix" || tab === "audit") {
      router.replace("/administration/roles");
    } else {
      router.replace("/administration/users");
    }
  }, [router, params]);

  return null;
}

export default function SettingsAccessRedirect() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center">
      <p className="text-steel text-sm">Redirecting to Administration…</p>
      <Suspense>
        <RedirectInner />
      </Suspense>
    </div>
  );
}
