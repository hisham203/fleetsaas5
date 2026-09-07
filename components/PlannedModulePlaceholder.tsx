"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";

// Milestone AB, Part 4/9 — a shared, honest placeholder shell reused by
// four SEPARATE routes (Maintenance stays as its own real screen;
// Inventory, Procurement, and Master Items each get their own
// dedicated placeholder page using this component) — never merged into
// one screen, since the user explicitly requires these to remain
// separate modules with separate future permissions.
//
// Milestone Z.1, Part 10 — now wired to the real, empty-safe read APIs
// each module owns: `counts` fetches a genuine (currently zero) row
// count per endpoint and displays it — never a fabricated number. No
// create/edit UI is added here; that remains out of scope until a
// future CRUD milestone.
export default function PlannedModulePlaceholder({
  title,
  tagline,
  covers,
  boundary,
  relationships,
  counts,
}: {
  title: string;
  tagline: string;
  covers: string[];
  boundary: string;
  relationships: string[];
  counts?: { label: string; endpoint: string }[];
}) {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [liveCounts, setLiveCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!counts || counts.length === 0) return;
    Promise.all(
      counts.map(async (c) => {
        const res = await fetch(c.endpoint);
        const data = res.ok ? await res.json() : [];
        return [c.label, Array.isArray(data) ? data.length : 0] as const;
      })
    ).then((entries) => setLiveCounts(Object.fromEntries(entries)));
  }, [counts]);

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
            Schema foundation implemented. Operational CRUD will be added in later milestones.
          </div>

          {counts && counts.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {counts.map((c) => (
                <div key={c.label} className="bg-paper rounded-lg px-3 py-2">
                  <p className="text-steel text-xs">{c.label}</p>
                  <p className="text-lg font-semibold">{liveCounts ? liveCounts[c.label] ?? 0 : "…"}</p>
                </div>
              ))}
            </div>
          )}

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
