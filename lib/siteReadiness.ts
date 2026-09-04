export type SiteReadinessState = "READY" | "WARNING" | "MISSING";
export type SiteReadinessItem = { label: string; state: SiteReadinessState };

// Task K — Site Readiness Summary. Purely informational (same principle
// as Task J's Contract Readiness Summary: no scoring, nothing blocks
// using a site) — extracted into its own module specifically so this
// logic has a real, direct unit test rather than just a source-string
// check on the page file.
export function computeSiteReadinessItems(site: {
  customerId?: string | null;
  address?: string | null;
  cityCode?: string | null;
  zoneCode?: string | null;
  distanceBandCode?: string | null;
  lat?: number | null;
  lng?: number | null;
}): SiteReadinessItem[] {
  const items: SiteReadinessItem[] = [];

  items.push({ label: "Customer assigned", state: site.customerId ? "READY" : "MISSING" });
  items.push({ label: "Address present", state: site.address ? "READY" : "MISSING" });
  // cityCode/zoneCode/distanceBandCode are all optional at the schema
  // level (Task A1 deliberately made them so — assigning them was out
  // of scope for that pass), so a site missing them is a real gap for
  // anything using distance/city/zone-based pricing, but not something
  // this summary treats as a hard failure — WARNING, not MISSING.
  items.push({ label: "City code set", state: site.cityCode ? "READY" : "WARNING" });
  items.push({ label: "Zone code set", state: site.zoneCode ? "READY" : "WARNING" });
  items.push({ label: "Distance band set", state: site.distanceBandCode ? "READY" : "WARNING" });
  items.push({ label: "Coordinates present (for dispatch/map)", state: site.lat != null && site.lng != null ? "READY" : "WARNING" });

  return items;
}
