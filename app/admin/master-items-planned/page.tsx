"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Milestone Z.2 — Master Items now has a real CRUD page at
// /admin/master-items. This old placeholder URL redirects rather than
// 404ing, for anyone with the old link bookmarked.
export default function LegacyMasterItemsPlaceholderRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/master-items");
  }, [router]);
  return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Redirecting…</div>;
}
