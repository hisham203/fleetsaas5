"use client";

import { useEffect, useState } from "react";

// Milestone AF.1, Part 4/6 — read-only next-code preview for converted
// (system-numbered) entities. Calls the non-consuming preview API; the
// real number is allocated only when the parent form saves. Reports
// readiness to the parent so it can disable Save when no active series
// exists — there is no manual-code fallback for converted entities.
export default function NextCodePreview({
  entityType,
  label,
  onReady,
}: {
  entityType: string;
  label: string; // e.g. "Next supplier code"
  onReady?: (ready: boolean) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings/numbering-preview?entityType=${encodeURIComponent(entityType)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok) { setPreview(data.previewNumber); setError(null); onReady?.(true); }
        else { setPreview(null); setError(data.error ?? "Preview unavailable"); onReady?.(false); }
      })
      .catch(() => { if (!cancelled) { setError("Preview unavailable"); onReady?.(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  return (
    <div className="bg-paper rounded-lg px-3 py-2">
      <p className="text-steel text-xs">{label}</p>
      {error ? (
        <p className="text-danger text-xs mt-0.5">Configure active numbering series in Settings first.</p>
      ) : (
        <>
          <p className="font-mono font-medium text-sm">{preview ?? "…"}</p>
          <p className="text-steel text-[11px] mt-0.5">Generated from Settings numbering series. Final code is allocated when you save. If another user creates a record at the same time, the saved code may be the next available number.</p>
        </>
      )}
    </div>
  );
}
