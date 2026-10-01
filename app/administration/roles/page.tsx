"use client";
/**
 * Administration — Roles & Permissions  (canonical, full workspace)
 * Route: /administration/roles
 *
 * Tabs:
 *   Roles        — system roles + tenant custom roles (separated, labelled)
 *   Permission Matrix — grant/revoke permissions per role
 *   Audit        — RBAC audit log
 *
 * All APIs existing. No new logic. No LEGACY_PERMISSIONS change.
 * Duplicate-role explanation: /api/roles returns both system (tenantId IS NULL)
 * and tenant roles — intentional. Separated visually by labelled groups.
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge,
  EmptyState, LoadingState, Btn, FilterBar,
} from "@/components/ds";

// ── Types ─────────────────────────────────────────────────────────────────────
type Perm = {
  id: string; module: string; action: string;
  code: string | null; category: string | null; description: string | null; isSensitive: boolean;
};
type Role = {
  id: string; name: string; label: string; description: string | null;
  isActive: boolean; isSystemRole: boolean; tenantId: string | null;
  rolePermissions: { permission: Perm }[];
  userRoles: any[];
};
type AuditRow = {
  id: string; action: string; targetType: string; targetId: string;
  targetLabel: string | null; actorId: string; detail: string | null; createdAt: string;
};
type Tab = "roles" | "matrix" | "audit";

// ── Module grouping for permission matrix ──────────────────────────────────────
const MODULE_GROUPS: Record<string, string[]> = {
  "OPERATIONS":     ["orders", "trips", "dispatch", "control_tower"],
  "DRIVER":         ["driver"],
  "FLEET":          ["vehicles", "drivers"],
  "CRM":            ["customers", "sites"],
  "COMMERCIAL":     ["contracts"],
  "FINANCE":        ["billing", "expenses"],
  "MAINTENANCE":    ["maintenance", "workshops"],
  "PROCUREMENT":    ["procurement", "inventory"],
  "REPORTS":        ["reports", "scorecards"],
  "ADMINISTRATION": ["settings"],
};

// ── Roles Tab ─────────────────────────────────────────────────────────────────
function RolesTab({
  roles, onRefresh,
}: { roles: Role[]; onRefresh: () => void }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", label: "", description: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const systemRoles = roles.filter(r => r.isSystemRole || r.tenantId === null);
  const tenantRoles = roles.filter(r => !r.isSystemRole && r.tenantId !== null);
  const filterFn = (r: Role) => !search ||
    r.label.toLowerCase().includes(search.toLowerCase()) ||
    r.name.toLowerCase().includes(search.toLowerCase());

  async function createRole() {
    setFormError(null);
    if (!form.name || !form.label) { setFormError("Name and label are required."); return; }
    const res = await fetch("/api/roles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) { const d = await res.json(); setFormError(d.error ?? "Failed."); return; }
    setCreating(false); setForm({ name: "", label: "", description: "" }); onRefresh();
  }

  async function toggleActive(role: Role) {
    await fetch(`/api/roles/${role.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !role.isActive }),
    });
    onRefresh();
  }

  function RoleTable({ group, label, note }: { group: Role[]; label: string; note: string }) {
    const filtered = group.filter(filterFn);
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 bg-paper">
          <h2 className="text-sm font-semibold text-ink">{label}</h2>
          <p className="text-xs text-steel mt-0.5">{note}</p>
        </div>
        {filtered.length === 0 ? <EmptyState title="No roles match filter" /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {["Role", "Internal Name", "Permissions", "Users", "Status", ""].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(role => (
                <>
                  {/* Using string key on the fragment alternative — use React.Fragment */}
                  {[
                    <tr key={role.id} className="hover:bg-paper">
                      <td className="px-4 py-3 font-semibold text-ink">{role.label}</td>
                      <td className="px-4 py-3 text-xs font-mono text-steel">{role.name}</td>
                      <td className="px-4 py-3 text-steel">{role.rolePermissions.length}</td>
                      <td className="px-4 py-3 text-steel">{role.userRoles.length}</td>
                      <td className="px-4 py-3"><StatusBadge status={role.isActive ? "ACTIVE" : "INACTIVE"} size="xs" /></td>
                      <td className="px-4 py-3 space-x-2">
                        <button onClick={() => setExpanded(expanded === role.id ? null : role.id)}
                          className="text-xs text-aqua hover:underline">
                          {expanded === role.id ? "Hide" : "Permissions"}
                        </button>
                        {!role.isSystemRole && (
                          <button onClick={() => toggleActive(role)}
                            className="text-xs text-steel hover:text-ink hover:underline">
                            {role.isActive ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>,
                    expanded === role.id && role.rolePermissions.length > 0 && (
                      <tr key={`perm-${role.id}`} className="bg-paper">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {role.rolePermissions.map(rp => (
                              <span key={rp.permission.id}
                                className="text-2xs bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono text-steel">
                                {rp.permission.code ?? `${rp.permission.module}.${rp.permission.action}`}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  ]}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        <Btn variant="secondary" size="sm" onClick={() => { setCreating(v => !v); setFormError(null); }}>
          {creating ? "Cancel" : "+ Create Role"}
        </Btn>
      </div>

      {creating && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 max-w-md">
          <h3 className="text-sm font-semibold text-ink mb-3">Create Custom Role</h3>
          <div className="space-y-2">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              placeholder="Internal name (e.g. operations_supervisor)"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              placeholder="Display label (e.g. Operations Supervisor)"
              value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              placeholder="Description (optional)"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            {formError && <p className="text-xs text-danger">{formError}</p>}
            <div className="flex gap-2">
              <Btn variant="primary" size="sm" onClick={createRole}>Create Role</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <RoleTable
        group={systemRoles} label="System Roles"
        note="Built-in Smarty1 roles. Apply to all tenants. Cannot be deleted."
      />
      <RoleTable
        group={tenantRoles} label="Custom Roles"
        note="Roles created for this tenant only."
      />
    </div>
  );
}

// ── Permission Matrix Tab ──────────────────────────────────────────────────────
function PermissionMatrixTab({ roles, permsGrouped }: { roles: Role[]; permsGrouped: Record<string, Perm[]> }) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const editableRoles = roles.filter(r => !r.isSystemRole && r.tenantId !== null);

  function selectRole(r: Role) {
    setSelectedRole(r);
    setSavedMsg("");
    setGranted(new Set(
      (r.rolePermissions ?? [])
        .map(rp => rp.permission?.code ?? `${rp.permission?.module}.${rp.permission?.action}`)
        .filter(Boolean)
    ));
  }

  function toggle(code: string) {
    setGranted(prev => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });
  }

  async function save() {
    if (!selectedRole) return;
    setSaving(true); setSavedMsg("");
    const allPerms = Object.values(permsGrouped).flat();
    const permCodes = [...granted];
    const permIds = allPerms.filter(p => permCodes.includes(p.code ?? `${p.module}.${p.action}`)).map(p => p.id);
    await fetch(`/api/roles/${selectedRole.id}/permissions`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissionIds: permIds }),
    });
    setSaving(false); setSavedMsg("✓ Permissions saved.");
  }

  if (editableRoles.length === 0) {
    return (
      <EmptyState
        title="No custom roles to configure"
        description="Create a custom role in the Roles tab first. System roles cannot be edited."
      />
    );
  }

  return (
    <div className="flex gap-4">
      {/* Role selector */}
      <div className="w-56 shrink-0 bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-paper">
          <p className="text-xs font-semibold text-steel uppercase">Custom Roles</p>
          <p className="text-xs text-steel/70 mt-0.5">System roles have fixed permissions</p>
        </div>
        <div className="divide-y divide-slate-100">
          {editableRoles.map(r => (
            <button
              key={r.id}
              onClick={() => selectRole(r)}
              className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                selectedRole?.id === r.id ? "bg-aqua/10 text-aqua font-medium" : "hover:bg-paper text-ink"
              }`}
            >
              <div>{r.label}</div>
              <div className="text-xs text-steel mt-0.5">{r.rolePermissions.length} permissions</div>
            </button>
          ))}
        </div>
      </div>

      {/* Matrix */}
      <div className="flex-1">
        {!selectedRole ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card flex items-center justify-center h-48">
            <p className="text-steel text-sm">Select a custom role to configure its permissions.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{selectedRole.label} — Permission Matrix</p>
                <p className="text-xs text-steel mt-0.5">Click checkboxes to grant/revoke. Save when done.</p>
              </div>
              <div className="flex items-center gap-3">
                {savedMsg && <span className="text-xs text-ok">{savedMsg}</span>}
                <Btn variant="primary" size="sm" disabled={saving} onClick={save}>
                  {saving ? "Saving…" : "Save Permissions"}
                </Btn>
              </div>
            </div>
            <div className="p-5 overflow-x-auto">
              {Object.entries(MODULE_GROUPS).map(([groupName, modules]) => {
                const groupPerms = Object.entries(permsGrouped)
                  .filter(([cat]) => modules.some(m => cat.toLowerCase().includes(m.toLowerCase())))
                  .flatMap(([, ps]) => ps);
                if (groupPerms.length === 0) return null;
                return (
                  <div key={groupName} className="mb-4">
                    <p className="text-xs font-semibold text-steel uppercase mb-2">{groupName}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {groupPerms.map(p => {
                        const key = p.code ?? `${p.module}.${p.action}`;
                        return (
                          <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-paper rounded p-1">
                            <input type="checkbox" checked={granted.has(key)} onChange={() => toggle(key)}
                              className="rounded accent-aqua" />
                            <span className="font-mono text-steel">{key}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────
function AuditTab() {
  const [log, setLog] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/role-audit-log?limit=100")
      .then(r => r.ok ? r.json() : { log: [] })
      .then(d => { setLog(d.log ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (!log.length) return <EmptyState title="No RBAC audit events yet" description="Role and permission changes are recorded here." />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-ink">Authorization Audit Log</h2>
        <p className="text-xs text-steel mt-0.5">Role assignments, revocations, and permission changes. Tenant-scoped.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-paper">
              {["Action", "Target", "Label", "Actor", "Time"].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {log.map(row => (
              <tr key={row.id} className="hover:bg-paper">
                <td className="px-4 py-2.5 text-xs font-mono">{row.action}</td>
                <td className="px-4 py-2.5 text-xs text-steel">{row.targetType}</td>
                <td className="px-4 py-2.5 text-xs text-steel">{row.targetLabel ?? row.targetId}</td>
                <td className="px-4 py-2.5 text-xs text-steel font-mono">{row.actorId.slice(0, 8)}…</td>
                <td className="px-4 py-2.5 text-xs text-steel">
                  {new Date(row.createdAt).toLocaleString("en-SA", { dateStyle: "short", timeStyle: "short" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const [tab, setTab] = useState<Tab>("roles");
  const [roles, setRoles] = useState<Role[]>([]);
  const [permsGrouped, setPermsGrouped] = useState<Record<string, Perm[]>>({});
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    const [rRes, pRes] = await Promise.allSettled([
      fetch("/api/roles"),
      fetch("/api/permissions"),
    ]);
    if (rRes.status === "fulfilled" && rRes.value.ok) setRoles((await rRes.value.json()).roles ?? []);
    if (pRes.status === "fulfilled" && pRes.value.ok) setPermsGrouped((await pRes.value.json()).grouped ?? {});
    setLoading(false);
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const systemRoles = roles.filter(r => r.isSystemRole || r.tenantId === null);
  const tenantRoles = roles.filter(r => !r.isSystemRole && r.tenantId !== null);
  const totalPerms = Object.values(permsGrouped).flat().length;

  const TABS: { id: Tab; label: string }[] = [
    { id: "roles",  label: "Roles" },
    { id: "matrix", label: "Permission Matrix" },
    { id: "audit",  label: "Audit Log" },
  ];

  return (
    <AdminShell title="Roles & Permissions">
      <PageContainer>
        <PageHeader
          title="Roles & Permissions"
          subtitle="System and custom roles, permission matrix, and RBAC audit log"
          breadcrumbs={[{ label: "Administration" }, { label: "Roles" }]}
          actions={<Btn variant="ghost" size="sm" onClick={loadRoles}>↺</Btn>}
        />

        <div className="grid grid-cols-4 gap-3 mb-6">
          <MetricCard label="System Roles" value={systemRoles.length} />
          <MetricCard label="Custom Roles" value={tenantRoles.length} />
          <MetricCard label="Total Roles" value={roles.length} />
          <MetricCard label="Permissions" value={totalPerms} />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-paper rounded-xl p-1 w-fit border border-slate-200">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors font-medium ${
                tab === t.id ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <LoadingState /> : (
          <>
            {tab === "roles"  && <RolesTab roles={roles} onRefresh={loadRoles} />}
            {tab === "matrix" && <PermissionMatrixTab roles={roles} permsGrouped={permsGrouped} />}
            {tab === "audit"  && <AuditTab />}
          </>
        )}
      </PageContainer>
    </AdminShell>
  );
}
