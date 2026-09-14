"use client";
import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";

// RC1 — Standalone dashboard page. The executive summary and KPIs 
// previously lived as a tab inside app/admin/page.tsx. This gives 
// the dashboard a proper URL for direct navigation.
export default function DashboardPage() {
  const { session, loading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/executive/dashboard").then(r => r.json()).then(setData).catch(() => {});
  }, [session]);

  if (loading || !session) return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;

  const kpis = data ? [
    { label: "Active Contracts", value: data.activeContracts ?? "—", sub: "contracts" },
    { label: "Orders Today", value: data.ordersToday ?? "—", sub: "deliveries" },
    { label: "Active Trips", value: data.activeTrips ?? "—", sub: "in progress" },
    { label: "Open Invoices", value: data.openInvoicesCount ?? "—", sub: "awaiting settlement" },
  ] : [];

  return (
    <AdminShell title="Dashboard">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Operations Dashboard</h1>
          <p className="text-steel text-sm mt-0.5">Live operational summary for {session.name ?? "your account"}.</p>
        </div>
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {kpis.map(k => (
              <div key={k.label} className="card card-body">
                <p className="text-steel text-xs uppercase tracking-wide">{k.label}</p>
                <p className="text-2xl font-semibold mt-1">{k.value}</p>
                <p className="text-steel text-xs mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card card-body">
            <h2 className="font-medium text-sm mb-3">Quick Links</h2>
            <div className="space-y-2">
              {[["Control Tower", "/admin/dispatch"], ["Dispatch (Live)", "/dispatch"], ["Customers & Sites", "/admin/customers"], ["Contracts", "/admin/contracts"], ["Loading Points", "/admin/loading-points"], ["Fleet", "/admin?tab=fleet"], ["Reports", "/admin?tab=reports"]].map(([label, href]) => (
                <a key={href} href={href} className="block text-aquaDark text-sm hover:underline">{label as string} →</a>
              ))}
            </div>
          </div>
          <div className="card card-body">
            <h2 className="font-medium text-sm mb-3">Operational Modules</h2>
            <div className="space-y-2">
              {[["Procurement", "/admin/procurement"], ["Inventory", "/admin/inventory"], ["Maintenance", "/admin?tab=maintenance"], ["Expenses", "/admin/expenses"], ["Settings", "/admin/settings"]].map(([label, href]) => (
                <a key={href} href={href} className="block text-aquaDark text-sm hover:underline">{label as string} →</a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
