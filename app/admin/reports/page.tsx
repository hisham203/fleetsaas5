"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";

// RC1 — Standalone Reports page using the existing robust report engine.
// Mirrors the ReportsTab from admin/page.tsx but with a dedicated URL,
// and adds quick operational report shortcuts.
export default function ReportsPage() {
  const { session, loading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetKey, setDatasetKey] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [result, setResult] = useState<{ columns: any[]; rows: any[]; totalMatched: number } | null>(null);
  const [running, setRunning] = useState(false);

  const loadMeta = useCallback(async () => {
    const ds = await fetch("/api/reports/datasets").then(r => r.json()).catch(() => []);
    setDatasets(Array.isArray(ds) ? ds : []);
  }, []);

  useEffect(() => { if (session) loadMeta(); }, [session, loadMeta]);

  function selectDataset(key: string) {
    setDatasetKey(key);
    const ds = datasets.find((d: any) => d.key === key);
    setColumns(ds ? ds.columns.map((c: any) => c.key) : []);
    setResult(null);
  }

  async function run() {
    if (!datasetKey) return;
    setRunning(true);
    const body = { datasetKey, config: { columns, filters: [], sortColumn: "", sortDirection: "desc" } };
    const r = await fetch("/api/reports/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setRunning(false);
    if (r.ok) setResult(await r.json());
  }

  function exportCSV() {
    if (!result) return;
    const header = result.columns.map((c: any) => c.label).join(",");
    const rows = result.rows.map((row: any) => result.columns.map((c: any) => JSON.stringify(row[c.key] ?? "")).join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${datasetKey}-report.csv`; a.click();
  }

  if (loading || !session) return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;

  const currentDS = datasets.find((d: any) => d.key === datasetKey);

  return (
    <AdminShell title="Reports">
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Reports</h1>
          {result && <button onClick={exportCSV} className="text-aquaDark text-sm font-medium hover:underline">Export CSV</button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {datasets.map((d: any) => (
            <button key={d.key} onClick={() => selectDataset(d.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${datasetKey === d.key ? "bg-ink text-white border-ink" : "bg-white border-slate-200 text-steel hover:border-ink"}`}>
              {d.label}
            </button>
          ))}
        </div>
        {currentDS && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">{currentDS.label}</p>
              <button onClick={run} disabled={running} className="bg-ink text-white rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-40">
                {running ? "Running…" : "Run Report"}
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {currentDS.columns.map((c: any) => (
                <label key={c.key} className="flex items-center gap-1 text-xs text-steel cursor-pointer">
                  <input type="checkbox" checked={columns.includes(c.key)} onChange={e => setColumns(v => e.target.checked ? [...v, c.key] : v.filter(k => k !== c.key))} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {result && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
              <p className="text-steel text-xs">{result.totalMatched} rows</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-steel text-xs uppercase">
                  <tr>{result.columns.map((c: any) => <th key={c.key} className="text-left px-4 py-2 whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row: any, i: number) => (
                    <tr key={i} className="border-t border-slate-50">
                      {result.columns.map((c: any) => <td key={c.key} className="px-4 py-2 text-xs whitespace-nowrap">{String(row[c.key] ?? "—")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {!datasetKey && <p className="text-steel text-sm text-center py-8">Select a dataset above to run a report.</p>}
      </div>
    </AdminShell>
  );
}
