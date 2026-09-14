"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type AdminNavItem = { label: string; icon?: string; href?: string; onClick?: () => void; activeKey?: string };
export type AdminNavSection = { label: string; items: AdminNavItem[] };

// Icons — lightweight SVG strings for nav items
const NAV_ICONS: Record<string, string> = {
  "Dashboard":            "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  "Control Tower":        "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  "Dispatch":             "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  "Orders":               "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  "Customers":            "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  "Contracts":            "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  "Fleet":                "M8 17h12m0 0l-4-4m4 4l-4 4M8 7h12M8 7L4 3m4 4L4 11",
  "Drivers":              "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  "Loading Points":       "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z",
  "Maintenance":          "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
  "Master Items":         "M4 6h16M4 10h16M4 14h16M4 18h16",
  "Inventory":            "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  "Procurement":          "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
  "Expenses":             "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "Reports":              "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  "Settings":             "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
  "Dispatch (Live)":      "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
  "Billing":              "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  "Scorecards":           "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z",
  "Automation":           "M13 10V3L4 14h7v7l9-11h-7z",
  "ERP Sync":             "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  "Workshops":            "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z",
};

function NavIcon({ path }: { path?: string }) {
  if (!path) return null;
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const DEFAULT_SECTIONS: AdminNavSection[] = [
  { label: "", items: [{ label: "Overview / Dashboard", href: "/admin" }] },
  {
    label: "Operations",
    items: [
      { label: "Dispatch Control Tower", href: "/admin/dispatch" },
      { label: "Dispatch (Live)", href: "/dispatch" },
      { label: "Contract & Capacity Planner", href: "/admin/contract-planner" },
      { label: "Loading Points", href: "/admin/loading-points" },
    ],
  },
  {
    label: "Core Data",
    items: [
      { label: "Fleet", href: "/admin?tab=fleet" },
      { label: "Drivers", href: "/admin?tab=drivers" },
      { label: "Customers & Sites", href: "/admin/customers" },
      { label: "Contracts", href: "/admin/contracts" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Billing", href: "/admin?tab=billing" },
      { label: "Expenses", href: "/admin/expenses" },
      { label: "Scorecards", href: "/admin?tab=scorecards" },
      { label: "Reports", href: "/admin?tab=reports" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Maintenance", href: "/admin?tab=maintenance" },
      { label: "Inventory", href: "/admin/inventory" },
      { label: "Procurement", href: "/admin/procurement" },
      { label: "Master Items", href: "/admin/master-items" },
      { label: "Workshops", href: "/admin/workshops" },
      { label: "Settings", href: "/admin/settings" },
    ],
  },
];

export default function AdminShell({
  title,
  tenantName,
  children,
  sections,
  activeKey,
  extra,
}: {
  title: string;
  tenantName?: string;
  children: React.ReactNode;
  sections?: AdminNavSection[];
  activeKey?: string;
  extra?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navSections = sections ?? DEFAULT_SECTIONS;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const isActive = (item: AdminNavItem) =>
    item.activeKey != null ? item.activeKey === activeKey : (pathname === item.href || (item.href && item.href !== "/admin" && pathname.startsWith(item.href.split("?")[0])));

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-aqua/20 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-aqua" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white leading-none">Smarty1</p>
          <p className="text-2xs text-slate-500 mt-0.5 truncate">{tenantName ?? "Fleet Operations"}</p>
        </div>
        <button className="md:hidden ml-auto text-slate-500 hover:text-white" onClick={() => setMobileOpen(false)}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navSections.map((section, i) => (
          <div key={i} className="mb-1">
            {section.label && (
              <p className="nav-group-label">{section.label}</p>
            )}
            {section.items.map((item, j) => {
              const active = isActive(item);
              const cls = active ? "nav-item-active" : "nav-item";
              if (item.onClick) {
                return (
                  <button key={j} onClick={() => { item.onClick!(); setMobileOpen(false); }} className={cls + " w-full text-left"}>
                    <NavIcon path={item.icon ?? NAV_ICONS[item.label]} />
                    <span>{item.label}</span>
                  </button>
                );
              }
              return (
                <a key={j} href={item.href} className={cls} onClick={() => setMobileOpen(false)}>
                  <NavIcon path={item.icon ?? NAV_ICONS[item.label]} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 p-3">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm text-slate-500 hover:text-white hover:bg-sidebar-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col shrink-0 bg-sidebar"
        style={{ width: "var(--sidebar-width)" }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-surface border-b border-slate-200 px-4 flex items-center justify-between gap-3 shrink-0" style={{ height: "var(--topbar-height)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden text-steel hover:text-ink" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-ink truncate">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {extra}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
