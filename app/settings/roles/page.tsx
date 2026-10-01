"use client";
/**
 * /settings/roles — COMPATIBILITY REDIRECT
 *
 * Roles & Permissions has moved to /administration/roles.
 * This redirect preserves bookmarked links.
 * Cannot loop — /administration/roles has no redirect.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsRolesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/administration/roles"); }, [router]);
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center">
      <p className="text-steel text-sm">Redirecting to Administration → Roles…</p>
    </div>
  );
}
