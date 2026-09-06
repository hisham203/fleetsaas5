"use client";

import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";

// Milestone AB, Part 4/9 — a shared, honest placeholder shell reused by
// four SEPARATE routes (Maintenance stays as its own real screen;
// Inventory, Procurement, and Master Items each get their own
// dedicated placeholder page using this component) — never merged into
// one screen, since the user explicitly requires these to remain
// separate modules with separate future permissions. Every instance
// shows zero fabricated data and states plainly that schema/design is
// pending approval.
export default function PlannedModulePlaceholder({
  title,
  tagline,
  covers,
  boundary,
  relationships,
}: {
  title: string;
  tagline: string;
  covers: string[];
  boundary: string;
  relationships: string[];
}) {
  const { session, loading } = useRequireSession(["ADMIN"]);
  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title={title}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-steel text-sm mt-0.5">{tagline}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="bg-warn/10 text-warn rounded-lg px-4 py-2 text-sm">
            Planned module — schema/design pending. No live data exists yet — nothing shown here is real or fabricated.
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">What this will cover</h3>
            <ul className="text-steel text-sm list-disc list-inside space-y-0.5">
              {covers.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">What this module does not do</h3>
            <p className="text-steel text-sm">{boundary}</p>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">Relationships to other modules</h3>
            <ul className="text-steel text-sm list-disc list-inside space-y-0.5">
              {relationships.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
