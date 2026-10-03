"use client";
/**
 * Administration — Users & Access  (canonical)
 * Route: /administration/users
 *
 * Full user management workspace — user list, create user, role assignment,
 * effective permissions. All existing APIs, no new logic.
 *
 * APIs used:
 *   GET  /api/users             — user list with userRoles embedded
 *   POST /api/users             — create user
 *   GET  /api/roles             — system + tenant roles for assignment
 *   GET  /api/user-roles        — user→role mappings
 *   POST /api/user-roles        — assign role
 *   DELETE /api/user-roles      — revoke role
 *
 * RBAC preserved: all API routes enforce their own permissions server-side.
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge,
  EmptyState, LoadingState, Btn, FilterBar,
} from "@/components/ds";

// ── Types ─────────────────────────────────────────────────────────────────────
type Role = {
  id: string; name: string; label: string; description: string | null;
  isActive: boolean; isSystemRole: boolean; tenantId: string | null;
  rolePermissions: { permission: { id: string; code: string | null; module: string; action: string } }[];
  userRoles: any[];
};
type UserRow = {
  id: string; name: string; email: string; role: string;
  status?: string; createdAt?: string;
  userRoles?: { id: string; roleId: string; role: Role }[];
};

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

// ── Create User Form ───────────────────────────────────────────────────────────
function CreateUserForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "DISPATCHER" | "DRIVER">("DISPATCHER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null); setSubmitting(true);
    const res = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to create user.");
      return;
    }
    onCreated();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 max-w-md">
      <h3 className="text-sm font-semibold text-ink mb-4">Create New User</h3>
      <div className="space-y-3">
        <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
        <input type="email" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Initial password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} />
        <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          value={role} onChange={e => setRole(e.target.value as any)}>
          <option value="DISPATCHER">Dispatcher</option>
          <option value="DRIVER">Driver</option>
          <option value="ADMIN">Admin (cannot escalate beyond own level)</option>
        </select>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Btn variant="primary" size="sm"
            disabled={!name || !email || password.length < 6 || submitting}
            onClick={submit}>
            {submitting ? "Creating…" : "Create User"}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}

// ── User Detail Panel ──────────────────────────────────────────────────────────
function UserDetailPanel({
  user, allRoles, onAssign, onRevoke, busy,
}: {
  user: UserRow; allRoles: Role[];
  onAssign: (userId: string, roleId: string) => void;
  onRevoke: (userId: string, roleId: string) => void;
  busy: boolean;
}) {
  const assigned = user.userRoles ?? [];
  const available = allRoles.filter(r => r.isActive && !assigned.find(ur => ur.roleId === r.id));

  return (
    <div className="bg-paper rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{user.name}</p>
          <p className="text-xs text-steel">{user.email}</p>
        </div>
        <StatusBadge status={user.role} size="xs" />
      </div>

      <div>
        <p className="text-xs font-semibold text-steel uppercase mb-2">Assigned Roles</p>
        {assigned.length === 0 ? (
          <p className="text-xs text-steel italic">No explicit roles — legacy system role ({user.role}) applies.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {assigned.map(ur => (
              <span key={ur.id} className="inline-flex items-center gap-1 text-xs bg-ink/10 rounded-lg px-2 py-0.5">
                {ur.role?.label ?? ur.roleId}
                <button
                  onClick={() => onRevoke(user.id, ur.roleId)}
                  disabled={busy}
                  className="text-danger font-bold text-[11px] leading-none ms-0.5 hover:text-dangerDark disabled:opacity-40"
                  title="Revoke role"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {available.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-steel uppercase mb-1">Add Role</p>
          <select
            disabled={busy}
            onChange={e => { if (e.target.value) { onAssign(user.id, e.target.value); (e.target as HTMLSelectElement).value = ""; } }}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-steel"
          >
            <option value="">+ Assign role…</option>
            {available.map(r => <option key={r.id} value={r.id}>{r.label} {r.isSystemRole ? "(system)" : ""}</option>)}
          </select>
        </div>
      )}

      <div>
        <p className="text-xs text-steel">Joined: {fmtDate(user.createdAt)}</p>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [uRes, rRes] = await Promise.allSettled([
      fetch("/api/users"),
      fetch("/api/roles"),
    ]);
    if (uRes.status === "fulfilled" && uRes.value.ok) {
      const d = await uRes.value.json();
      setUsers(d.users ?? (Array.isArray(d) ? d : []));
    } else setError("Failed to load users.");
    if (rRes.status === "fulfilled" && rRes.value.ok) {
      const d = await rRes.value.json();
      setAllRoles(d.roles ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep selected user in sync after reload:
  useEffect(() => {
    if (selected) {
      const refreshed = users.find(u => u.id === selected.id);
      if (refreshed) setSelected(refreshed);
    }
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(userId: string, roleId: string) {
    setBusy(true);
    await fetch("/api/user-roles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, roleId }),
    });
    await load(); setBusy(false);
  }

  async function revoke(userId: string, roleId: string) {
    setBusy(true);
    await fetch("/api/user-roles", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, roleId }),
    });
    await load(); setBusy(false);
  }

  const filtered = users.filter(u =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    total: users.length,
    admin: users.filter(u => u.role === "ADMIN").length,
    dispatcher: users.filter(u => u.role === "DISPATCHER").length,
    driver: users.filter(u => u.role === "DRIVER").length,
  };

  return (
    <AdminShell title="Users & Access">
      <PageContainer>
        <PageHeader
          title="Users & Access"
          subtitle="Manage user accounts, system roles, and role assignments"
          breadcrumbs={[{ label: "Administration" }, { label: "Users" }]}
          actions={
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={() => { setCreating(v => !v); setSelected(null); }}>
                {creating ? "Cancel" : "+ Add User"}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        <div className="grid grid-cols-4 gap-3 mb-6">
          <MetricCard label="Total" value={counts.total} />
          <MetricCard label="Admins" value={counts.admin} accent="warn" />
          <MetricCard label="Dispatchers" value={counts.dispatcher} accent="ok" />
          <MetricCard label="Drivers" value={counts.driver} />
        </div>

        {creating && (
          <div className="mb-6">
            <CreateUserForm
              onCreated={() => { setCreating(false); load(); }}
              onCancel={() => setCreating(false)}
            />
          </div>
        )}

        {error && <div className="mb-4 text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>}

        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading ? <LoadingState /> : (
          <div className="flex gap-4">
            {/* User list */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
              {filtered.length === 0 ? (
                <EmptyState title="No users found" description="Try adjusting your search." />
              ) : (
                <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Name", "Email", "System Role", "Module Roles", "Joined", ""].map(h => (
                        <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(u => (
                      <tr
                        key={u.id}
                        className={`hover:bg-paper cursor-pointer ${selected?.id === u.id ? "bg-aqua/5" : ""}`}
                        onClick={() => setSelected(selected?.id === u.id ? null : u)}
                      >
                        <td className="px-4 py-3 font-medium text-ink">{u.name}</td>
                        <td className="px-4 py-3 text-steel text-xs">{u.email}</td>
                        <td className="px-4 py-3"><StatusBadge status={u.role} size="xs" /></td>
                        <td className="px-4 py-3 text-xs text-steel">
                          {(u.userRoles ?? []).length === 0
                            ? <span className="italic">none</span>
                            : (u.userRoles ?? []).map(ur => ur.role?.label ?? ur.roleId).join(", ")
                          }
                        </td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDate(u.createdAt)}</td>
                        <td className="px-4 py-3 text-xs text-aqua">
                          {selected?.id === u.id ? "▲" : "▼"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="w-80 shrink-0">
                <UserDetailPanel
                  user={selected}
                  allRoles={allRoles}
                  onAssign={assign}
                  onRevoke={revoke}
                  busy={busy}
                />
              </div>
            )}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
