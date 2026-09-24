"use client";
/**
 * P2-02: Users & Access Administration
 * Tabs: Users | Roles | Permission Matrix | Audit
 * All operations server-authoritative via API.
 */

import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type Perm = { id: string; module: string; action: string; code: string | null; category: string | null; description: string | null; isSensitive: boolean };
type Role = { id: string; name: string; label: string; description: string | null; isActive: boolean; isSystemRole: boolean; tenantId: string | null; rolePermissions: { permission: Perm }[]; userRoles: any[] };
type UserRow = { id: string; name: string; email: string; role: string; userRoles?: { id: string; role: Role }[] };
type AuditRow = { id: string; action: string; targetType: string; targetId: string; targetLabel: string | null; actorId: string; detail: string | null; createdAt: string };

type Tab = "users" | "roles" | "matrix" | "audit";

// ── Module grouping for permission matrix ──────────────────────────────────────
const MODULE_GROUPS: Record<string, string[]> = {
  "OPERATIONS": ["orders","trips","dispatch","control_tower"],
  "DRIVER": ["driver"],
  "FLEET": ["vehicles","drivers"],
  "CRM": ["customers","sites"],
  "COMMERCIAL": ["contracts"],
  "FINANCE": ["billing","expenses"],
  "MAINTENANCE": ["maintenance","workshops"],
  "PROCUREMENT": ["procurement","inventory"],
  "REPORTS": ["reports","scorecards"],
  "ADMINISTRATION": ["settings"],
};

function badge(text: string, color: string) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{text}</span>;
}

// ── Users Tab ──────────────────────────────────────────────────────────────────
function UsersTab({ roles }: { roles: Role[] }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [effPerms, setEffPerms] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.ok) setUsers((await res.json()).users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadEffective = useCallback(async (userId: string) => {
    const res = await fetch(`/api/users/${userId}/effective-permissions`);
    if (res.ok) setEffPerms((await res.json()).permissions ?? []);
  }, []);

  const selectUser = (u: UserRow) => { setSelected(u); loadEffective(u.id); setAssigning(false); setError(null); };

  const assignRole = async () => {
    if (!selected || !selectedRoleId) return;
    const res = await fetch("/api/user-roles", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selected.id, roleId: selectedRoleId }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed"); return; }
    await load(); const fresh = (await (await fetch("/api/users")).json()).users?.find((u: UserRow) => u.id === selected.id);
    if (fresh) { setSelected(fresh); loadEffective(fresh.id); }
    setAssigning(false); setSelectedRoleId("");
  };

  const removeRole = async (userRoleId: string) => {
    const res = await fetch(`/api/user-roles/${userRoleId}`, { method: "DELETE" });
    if (!res.ok) { setError("Failed to remove role"); return; }
    await load(); if (selected) { const fresh = (await (await fetch("/api/users")).json()).users?.find((u: UserRow) => u.id === selected.id); if (fresh) { setSelected(fresh); loadEffective(fresh.id); } }
  };

  const activeRoles = roles.filter(r => r.isActive);

  return (
    <div className="flex gap-6 h-full">
      <div className="w-80 flex-shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Users ({users.length})</div>
        {loading ? <div className="p-4 text-sm text-steel">Loading…</div> : (
          <div className="overflow-y-auto max-h-[600px]">
            {users.map(u => (
              <button key={u.id} onClick={() => selectUser(u)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${selected?.id === u.id ? "bg-aqua/5 border-l-2 border-l-aqua" : ""}`}>
                <div className="text-sm font-medium text-ink">{u.name}</div>
                <div className="text-xs text-steel">{u.email}</div>
                <div className="mt-1 flex gap-1 flex-wrap">
                  {(u.userRoles ?? []).map((ur: any) => (
                    <span key={ur.id} className="text-xs bg-aqua/10 text-aqua px-1.5 py-0.5 rounded">{ur.role?.label ?? ur.role?.name}</span>
                  ))}
                  {(u.userRoles ?? []).length === 0 && <span className="text-xs text-steel/60">No roles assigned</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected ? (
        <div className="flex-1 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="font-semibold text-ink">{selected.name}</div><div className="text-sm text-steel">{selected.email} · System role: {selected.role}</div></div>
              <button onClick={() => setAssigning(true)} className="text-sm bg-aqua text-white px-3 py-1.5 rounded-lg font-medium">+ Assign Role</button>
            </div>
            {assigning && (
              <div className="flex gap-2 mb-3 p-3 bg-slate-50 rounded-lg">
                <select value={selectedRoleId} onChange={e => setSelectedRoleId(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select a role…</option>
                  {activeRoles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <button onClick={assignRole} className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium">Assign</button>
                <button onClick={() => setAssigning(false)} className="border px-3 py-2 rounded-lg text-sm text-steel">Cancel</button>
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-steel uppercase mb-1">Assigned Roles</div>
              {(selected.userRoles ?? []).length === 0 ? (
                <div className="text-sm text-steel/60 py-2">No roles assigned — user has no permissions.</div>
              ) : (
                (selected.userRoles ?? []).map((ur: any) => (
                  <div key={ur.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <div><div className="text-sm font-medium">{ur.role?.label}</div><div className="text-xs text-steel font-mono">{ur.role?.name}</div></div>
                    <button onClick={() => removeRole(ur.id)} className="text-xs text-red-500 hover:text-red-700 ml-4">Remove</button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-steel uppercase mb-3">Effective Permissions ({effPerms.length})</div>
            <div className="text-xs text-steel mb-2">Union of all active role permissions. DENY BY DEFAULT — no roles = no permissions.</div>
            {effPerms.length === 0 ? <div className="text-sm text-steel/60">No effective permissions.</div> : (
              <div className="flex flex-wrap gap-1.5">
                {effPerms.sort().map(code => (
                  <span key={code} className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">{code}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-steel text-sm">Select a user to manage their roles and permissions.</div>
      )}
    </div>
  );
}

// ── Roles Tab ──────────────────────────────────────────────────────────────────
function RolesTab({ roles, onRefresh }: { roles: Role[]; onRefresh: () => void }) {
  const [selected, setSelected] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", label: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  const createRole = async () => {
    const res = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed"); return; }
    setCreating(false); setForm({ name: "", label: "", description: "" }); onRefresh();
  };

  const toggleActive = async (role: Role) => {
    const res = await fetch(`/api/roles/${role.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !role.isActive }) });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
    onRefresh();
  };

  return (
    <div className="flex gap-6">
      <div className="w-72 flex-shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-steel uppercase">Roles ({roles.length})</span>
          <button onClick={() => setCreating(true)} className="text-xs bg-aqua text-white px-2 py-1 rounded font-medium">+ New</button>
        </div>
        <div className="overflow-y-auto max-h-[600px]">
          {roles.map(r => (
            <button key={r.id} onClick={() => setSelected(r)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${selected?.id === r.id ? "bg-aqua/5 border-l-2 border-l-aqua" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink flex-1">{r.label}</span>
                {!r.isActive && badge("Inactive","bg-slate-100 text-slate-500")}
                {r.isSystemRole && badge("System","bg-amber-50 text-amber-700")}
              </div>
              <div className="text-xs text-steel mt-0.5">{r.rolePermissions?.length ?? 0} permissions · {r.userRoles?.length ?? 0} users</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
        {creating && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Create Role</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="text-xs text-steel block mb-1">Name (UPPER_SNAKE_CASE)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="OPERATION_SUPERVISOR" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"_") }))} /></div>
              <div><label className="text-xs text-steel block mb-1">Display Label</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Operation Supervisor" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></div>
            </div>
            <div className="mb-3"><label className="text-xs text-steel block mb-1">Description</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex gap-2"><button onClick={createRole} className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button><button onClick={() => setCreating(false)} className="border px-3 py-2 rounded-lg text-sm text-steel">Cancel</button></div>
          </div>
        )}
        {selected && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="font-semibold text-ink">{selected.label}</div><div className="text-xs font-mono text-steel">{selected.name}</div></div>
              {!selected.isSystemRole && (
                <button onClick={() => toggleActive(selected)} className={`text-xs px-3 py-1.5 rounded-lg font-medium border ${selected.isActive ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}>
                  {selected.isActive ? "Deactivate" : "Activate"}
                </button>
              )}
            </div>
            {selected.description && <p className="text-sm text-steel mb-3">{selected.description}</p>}
            <div className="text-xs font-semibold text-steel uppercase mb-2">Current Permissions ({selected.rolePermissions?.length ?? 0})</div>
            <div className="flex flex-wrap gap-1.5">
              {(selected.rolePermissions ?? []).map(rp => (
                <span key={rp.permission?.id} className={`text-xs font-mono px-2 py-0.5 rounded ${rp.permission?.isSensitive ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>{rp.permission?.code ?? `${rp.permission?.module}.${rp.permission?.action}`}</span>
              ))}
              {(selected.rolePermissions ?? []).length === 0 && <span className="text-xs text-steel/60">No permissions assigned. Use the Permission Matrix tab to add permissions.</span>}
            </div>
            <div className="mt-3 text-xs font-semibold text-steel uppercase mb-2">Assigned Users ({selected.userRoles?.length ?? 0})</div>
            {(selected.userRoles ?? []).length === 0 ? <div className="text-xs text-steel/60">No users assigned to this role.</div> : (
              <div className="flex flex-wrap gap-2">{(selected.userRoles ?? []).map((ur: any) => <span key={ur.id} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{ur.userId}</span>)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Permission Matrix Tab ──────────────────────────────────────────────────────
function PermissionMatrixTab({ roles, permsGrouped }: { roles: Role[]; permsGrouped: Record<string, Perm[]> }) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectRole = (r: Role) => {
    setSelectedRole(r);
    setGranted(new Set((r.rolePermissions ?? []).map(rp => rp.permission?.code ?? `${rp.permission?.module}.${rp.permission?.action}`).filter(Boolean)));
    setSaved(false);
  };

  const toggle = (code: string) => {
    setGranted(prev => { const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next; });
    setSaved(false);
  };

  const grantModule = (perms: Perm[]) => {
    setGranted(prev => { const next = new Set(prev); perms.forEach(p => { if (p.code) next.add(p.code); }); return next; });
    setSaved(false);
  };

  const clearModule = (perms: Perm[]) => {
    setGranted(prev => { const next = new Set(prev); perms.forEach(p => { if (p.code) next.delete(p.code); }); return next; });
    setSaved(false);
  };

  const save = async () => {
    if (!selectedRole) return;
    setSaving(true); setError(null);
    const res = await fetch(`/api/roles/${selectedRole.id}/permissions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissionCodes: [...granted] }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Save failed"); setSaving(false); return; }
    setSaved(true); setSaving(false);
  };

  const tenantRoles = roles.filter(r => r.tenantId !== null && r.isActive);

  return (
    <div className="flex gap-6">
      <div className="w-56 flex-shrink-0">
        <div className="text-xs font-semibold text-steel uppercase mb-2">Select Role to Edit</div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {tenantRoles.length === 0 ? <div className="p-4 text-sm text-steel">No tenant roles. Create a role first.</div> : (
            tenantRoles.map(r => (
              <button key={r.id} onClick={() => selectRole(r)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 text-sm ${selectedRole?.id === r.id ? "bg-aqua/5 border-l-2 border-l-aqua font-medium" : ""}`}>
                {r.label}
              </button>
            ))
          )}
        </div>
        <div className="text-xs text-steel mt-2">System roles cannot be edited.</div>
      </div>

      <div className="flex-1">
        {!selectedRole ? (
          <div className="flex items-center justify-center h-64 text-steel text-sm">Select a role to edit its permissions.</div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div><div className="font-semibold text-ink">{selectedRole.label} — Permission Matrix</div><div className="text-xs text-steel">Click checkboxes to grant/revoke. Save when done.</div></div>
              <div className="flex items-center gap-2">
                {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
                {error && <span className="text-xs text-red-600">{error}</span>}
                <button onClick={save} disabled={saving} className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save Permissions"}</button>
              </div>
            </div>
            <div className="space-y-4">
              {Object.entries(permsGrouped).map(([category, perms]) => (
                <div key={category} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-steel uppercase">{category}</span>
                    <div className="flex gap-2">
                      <button onClick={() => grantModule(perms)} className="text-xs text-aqua hover:underline">Grant all</button>
                      <button onClick={() => clearModule(perms)} className="text-xs text-steel hover:underline">Clear</button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {perms.map(p => {
                      const code = p.code ?? `${p.module}.${p.action}`;
                      const isGranted = granted.has(code);
                      return (
                        <label key={p.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer ${isGranted ? "bg-emerald-50/40" : ""}`}>
                          <input type="checkbox" checked={isGranted} onChange={() => toggle(code)} className="w-4 h-4 rounded accent-aqua" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono text-ink">{code}</span>
                              {p.isSensitive && <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">Sensitive</span>}
                            </div>
                            {p.description && <div className="text-xs text-steel">{p.description}</div>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Audit Tab ──────────────────────────────────────────────────────────────────
function AuditTab() {
  const [log, setLog] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/role-audit-log?limit=100").then(r => r.ok ? r.json() : { log: [] }).then(d => { setLog(d.log ?? []); setLoading(false); });
  }, []);

  const actionBadge = (action: string) => {
    if (action.includes("created")) return badge(action,"bg-emerald-50 text-emerald-700");
    if (action.includes("deactivated")) return badge(action,"bg-red-50 text-red-700");
    if (action.includes("removed")) return badge(action,"bg-amber-50 text-amber-700");
    return badge(action,"bg-slate-100 text-slate-600");
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">Authorization Audit Log</div>
        <span className="text-xs text-steel">{log.length} entries</span>
      </div>
      {loading ? <div className="p-6 text-sm text-steel text-center">Loading…</div> : log.length === 0 ? (
        <div className="p-6 text-sm text-steel text-center">No audit entries yet. Actions on roles and users will appear here.</div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
          {log.map(entry => (
            <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1">
                {actionBadge(entry.action)}
                <span className="text-sm text-steel ml-2">{entry.targetLabel ?? entry.targetId}</span>
                <div className="text-xs text-steel/60 mt-0.5">Actor: {entry.actorId}</div>
              </div>
              <div className="text-xs text-steel whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AccessPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [roles, setRoles] = useState<Role[]>([]);
  const [permsGrouped, setPermsGrouped] = useState<Record<string, Perm[]>>({});
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async () => {
    const [rolesRes, permsRes] = await Promise.all([fetch("/api/roles"), fetch("/api/permissions")]);
    if (rolesRes.ok) setRoles((await rolesRes.json()).roles ?? []);
    if (permsRes.ok) setPermsGrouped((await permsRes.json()).grouped ?? {});
    setLoading(false);
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "👤 Users" },
    { id: "roles", label: "🎭 Roles" },
    { id: "matrix", label: "🔑 Permission Matrix" },
    { id: "audit", label: "📋 Audit" },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-ink">Users & Access</h1>
        <p className="text-sm text-steel mt-0.5">Manage organizational roles, permissions, and user assignments</p>
      </div>

      <div className="flex gap-0 border-b border-slate-200 mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? "border-aqua text-aqua" : "border-transparent text-steel hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-16 text-steel">Loading…</div> : (
        <>
          {tab === "users" && <UsersTab roles={roles} />}
          {tab === "roles" && <RolesTab roles={roles} onRefresh={loadRoles} />}
          {tab === "matrix" && <PermissionMatrixTab roles={roles} permsGrouped={permsGrouped} />}
          {tab === "audit" && <AuditTab />}
        </>
      )}
    </div>
  );
}
