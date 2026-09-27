"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, FilterBar, EmptyState, LoadingState, MetricCard, Btn, StatusBadge } from "@/components/ds";

type User = { id: string; name?: string; email: string; role?: string; status?: string; tenantId?: string; createdAt?: string };

function fmtDate(d?: string) { if (!d) return "—"; return new Date(d).toLocaleDateString("en-SA", { day:"numeric", month:"short", year:"numeric" }); }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/users");
    if (!r.ok) { setError("Failed to load users."); setLoading(false); return; }
    const data = await r.json();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u =>
    !search ||
    (u.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.role ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const counts = { total: users.length, active: users.filter(u=>u.status==="ACTIVE"||!u.status).length };

  return (
    <AdminShell title="Users & Access">
      <PageContainer>
        <PageHeader
          title="Users & Access"
          subtitle="User accounts and role assignments"
          breadcrumbs={[{ label: "Administration" }, { label: "Users" }]}
          actions={
            <div className="flex gap-2">
              <a href="/settings/roles" className="text-xs text-aqua border border-aqua px-3 py-1.5 rounded-lg hover:bg-aqua/5 transition-colors">Manage Roles</a>
              <Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>
            </div>
          }
        />
        <div className="mb-4 text-xs text-infoLight bg-infoLight/30 border border-info/20 rounded-lg px-4 py-2 text-info">
          Full user management including role assignment is at <a href="/settings/access" className="underline">/settings/access</a>. This view is read-only.
        </div>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <MetricCard label="Total Users" value={counts.total} />
          <MetricCard label="Active" value={counts.active} accent="ok" />
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No users found" description={search ? "Try adjusting search." : "No users in this tenant."} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Name", "Email", "Role", "Status", "Joined"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(u => (
                    <tr key={u.id} className="hover:bg-paper">
                      <td className="px-4 py-3 text-sm font-medium text-ink">{u.name ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-steel">{u.email}</td>
                      <td className="px-4 py-3 text-sm text-steel">{u.role ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={u.status ?? "ACTIVE"} size="xs" /></td>
                      <td className="px-4 py-3 text-sm text-steel">{fmtDate(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">{filtered.length} of {users.length} users</div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
