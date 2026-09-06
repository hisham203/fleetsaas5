"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Milestone AB, Part 4 — this route previously showed one merged
// placeholder for Maintenance/Inventory/Procurement/Master Items
// together. The user has since clarified these must remain four
// separate modules (different future permissions for each) — so this
// old URL now redirects to Inventory's own dedicated page rather than
// 404ing for anyone with the old link bookmarked; Procurement and
// Master Items each have their own separate route, linked directly
// from the sidebar.
export default function LegacyMaintenanceInventoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/inventory-planned");
  }, [router]);
  return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Redirecting…</div>;
}
