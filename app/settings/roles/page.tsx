"use client";
/**
 * P2-02: Role Management UI
 * Tenant admins can view, create, and deactivate roles.
 * Full permission matrix editor is DEFERRED (backend model complete).
 */

import { useState, useEffect, useCallback } from "react";

type Role = {
  id: string;
  name: string;
  label: string;
  description: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  tenantId: string | null;
  rolePermissions: any[];
  userRoles: any[];
};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", label: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/roles");
      if (!res.ok) { setError("Failed to load roles"); return; }
      const data = await res.json();
      setRoles(data.roles ?? []);
    } catch { setError("Network error loading roles"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  async function createRole() {
    if (!form.name || !form.label) { setError("Role name and label are required"); return; }
    const res = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form) });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to create role"); return; }
    setCreating(false); setForm({ name: "", label: "", description: "" }); loadRoles();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">Roles & Access</h1>
          <p className="text-sm text-steel mt-0.5">Manage organizational roles and their permissions</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-aqua/90">
          + New Role
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>}

      {creating && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-ink mb-3">Create Role</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-steel block mb-1">Machine Name (UPPER_SNAKE_CASE)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="OPERATION_COORDINATOR" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase().replace(/\s/g,"_") }))} />
            </div>
            <div>
              <label className="text-xs text-steel block mb-1">Display Label</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Operation Coordinator" value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs text-steel block mb-1">Description</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Handles order intake and trip planning" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={createRole} className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button>
            <button onClick={() => setCreating(false)} className="border px-4 py-2 rounded-lg text-sm text-steel">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-steel text-sm">Loading roles…</div>
      ) : roles.length === 0 ? (
        <div className="text-center py-12 text-steel text-sm">No roles found. Create one above.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-steel">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-steel">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-steel">Permissions</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-steel">Users</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-steel">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-steel">System</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{role.label}</div>
                    {role.description && <div className="text-xs text-steel mt-0.5">{role.description}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-steel">{role.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs bg-slate-100 text-steel px-2 py-0.5 rounded-full">
                      {role.rolePermissions?.length ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs bg-slate-100 text-steel px-2 py-0.5 rounded-full">
                      {role.userRoles?.length ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${role.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {role.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {role.isSystemRole && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">System</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <strong>Permission Matrix Editor</strong> — deferred to next release. Roles can be created and assigned via the API.
        To assign permissions to a role, use <code className="bg-amber-100 px-1 rounded">POST /api/roles/[id]/permissions</code>.
      </div>
    </div>
  );
}
