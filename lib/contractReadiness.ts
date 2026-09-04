export type ReadinessState = "READY" | "WARNING" | "MISSING" | "UNSUPPORTED";
export type ReadinessItem = { label: string; state: ReadinessState };

// Task J — Contract Readiness Summary. Purely informational (per this
// task's own instruction: no scoring, nothing here blocks using the
// contract) — each row is computed independently from data the Contract
// Management module already fetches, no new API calls. Where a factor
// genuinely has no schema support at all (payment terms, PO/billing
// requirements — see Task J's audit), the row says so honestly as
// UNSUPPORTED rather than silently omitting it or faking a control that
// does nothing.
//
// Extracted into its own module (rather than living inline in
// app/admin/contracts/page.tsx) specifically so this logic has a real,
// direct unit test — not just a source-string check on the page file.
export function computeReadinessItems(
  contract: { customer?: { id?: string } | null; status: string; startDate: string | Date; endDate?: string | Date | null; appliesToAllSites: boolean; siteScope?: unknown[]; type: string },
  pricingRules: { rateType: string; tankerCapacityLtr?: number | null; distanceBandCode?: string | null }[],
  distanceBands: { code: string; isActive: boolean }[]
): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const isTripCount = contract.type === "ONE_TIME_TRIP_COUNT";
  const isMonthly = contract.type === "MONTHLY_ACCUMULATED";

  items.push({ label: "Customer assigned", state: contract.customer?.id ? "READY" : "MISSING" });
  items.push({ label: "Contract active", state: contract.status === "ACTIVE" ? "READY" : "WARNING" });

  const now = new Date();
  const start = new Date(contract.startDate);
  const end = contract.endDate ? new Date(contract.endDate) : null;
  let dateState: ReadinessState = "READY";
  if (now < start) dateState = "WARNING"; // not started yet
  else if (end && now > end) dateState = "WARNING"; // expired
  items.push({ label: "Within valid date period", state: dateState });

  if (contract.appliesToAllSites) {
    items.push({ label: "Site scope configured", state: "READY" });
  } else {
    items.push({ label: "Site scope configured", state: (contract.siteScope ?? []).length > 0 ? "READY" : "MISSING" });
  }

  const standardRules = pricingRules.filter((r) => r.rateType === "STANDARD");
  const overageRules = pricingRules.filter((r) => r.rateType === "OVERAGE");
  items.push({ label: "STANDARD pricing configured", state: standardRules.length > 0 ? "READY" : "MISSING" });
  if (isTripCount) {
    items.push({ label: "OVERAGE pricing configured", state: overageRules.length > 0 ? "READY" : "WARNING" });
  }

  // Capacity coverage: a wildcard-capacity rule (tankerCapacityLtr null)
  // already covers every capacity, so only flag a gap when SOME rules
  // are capacity-specific but not all three standard sizes are covered
  // and nothing wildcard exists to fall back on.
  const hasWildcardCapacityRule = pricingRules.some((r) => r.tankerCapacityLtr == null);
  const capacitiesCovered = new Set(pricingRules.map((r) => r.tankerCapacityLtr).filter((v): v is number => v != null));
  const allThreeCovered = [18000, 21000, 28000].every((c) => capacitiesCovered.has(c));
  let capacityState: ReadinessState = "MISSING";
  if (pricingRules.length === 0) capacityState = "MISSING";
  else if (hasWildcardCapacityRule || allThreeCovered) capacityState = "READY";
  else capacityState = "WARNING";
  items.push({ label: "Tanker capacity coverage", state: capacityState });

  const usedBandCodes = new Set(pricingRules.map((r) => r.distanceBandCode).filter((v): v is string => Boolean(v)));
  if (usedBandCodes.size > 0) {
    const allActive = Array.from(usedBandCodes).every((code) => distanceBands.some((b) => b.code === code && b.isActive));
    items.push({ label: "Distance band coverage", state: allActive ? "READY" : "WARNING" });
  }

  if (isMonthly) {
    items.push({ label: "Monthly billing readiness", state: "WARNING" }); // see the dedicated, live preview section for the actual detailed check
  }

  // Task J audit: neither of these has any schema support today — shown
  // honestly as unsupported rather than omitted or faked with a control
  // that would do nothing. See the final report's configuration matrix.
  items.push({ label: "Payment terms", state: "UNSUPPORTED" });
  items.push({ label: "Billing requirements (PO/VAT/etc.)", state: "UNSUPPORTED" });

  return items;
}
