"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, EmptyState, LoadingState, Btn, StatusBadge } from "@/components/ds";

type Report = { id: string; name: string; description?: string; category?: string; createdAt?: string };

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<{ reportId: string; data: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/reports");
    if (!r.ok) { setError("Failed to load reports."); setLoading(false); return; }
    const data = await r.json();
    setReports(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runReport(report: Report) {
    setRunning(report.id); setResults(null);
    const r = await fetch("/api/reports/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: report.id }),
    });
    setRunning(null);
    if (r.ok) { const data = await r.json(); setResults({ reportId: report.id, data }); }
    else { const err = await r.json(); alert(err.error ?? "Report failed."); }
  }

  return (
    <AdminShell title="Reports">
      <PageContainer>
        <PageHeader
          title="Reports"
          subtitle="Operational and analytics report builder"
          breadcrumbs={[{ label: "Analytics" }, { label: "Reports" }]}
          actions={<Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>}
        />

        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : reports.length === 0 ? (
          <EmptyState title="No reports" description="No report definitions configured." />
        ) : (
          <div className="space-y-3">
            {reports.map(report => (
              <div key={report.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-ink">{report.name}</h3>
                      {report.category && <StatusBadge status="ACTIVE" size="xs" />}
                    </div>
                    {report.description && <p className="text-xs text-steel">{report.description}</p>}
                  </div>
                  <Btn variant="secondary" size="xs"
                    onClick={() => runReport(report)}
                    disabled={running === report.id}>
                    {running === report.id ? "Running…" : "Run Report"}
                  </Btn>
                </div>
                {results?.reportId === report.id && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-xs font-semibold text-steel mb-2">Results</p>
                    <pre className="text-2xs bg-paper rounded-lg p-3 overflow-x-auto max-h-60 text-ink">
                      {JSON.stringify(results.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
