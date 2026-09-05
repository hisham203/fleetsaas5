// Milestone Q, Gate Q3 — reusable KPI summary card. Used by the Dispatch
// Control Tower, Contract Planner, and Loading Points modules. Every
// value passed in must come from real tenant data — per this milestone's
// own "no fake data" rule, this component never invents or hardcodes a
// number itself, it only renders whatever its caller computed.
export default function KpiCard({ label, value, tone }: { label: string; value: number | string; tone?: "default" | "warn" | "danger" | "ok" }) {
  const toneClass = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-steel text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}
