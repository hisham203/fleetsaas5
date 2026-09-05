"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// Milestone R — Smarty1 Operations Layout. This is now the single,
// primary Admin shell for the entire operations cockpit: the main
// /admin page (its 13 in-page tabs are now sidebar items instead of a
// horizontal bar — see Part 3), plus /admin/contracts, /admin/customers,
// and the three Milestone Q modules this shell already covered. /dispatch
// and /driver remain their own dispatcher/driver-facing surfaces,
// unchanged, and are linked to from here rather than absorbed into it.
//
// Nav items can be either a real route (`href`, highlighted by the
// current pathname) or an in-page tab switch (`onClick` + `activeKey`,
// used only by /admin/page.tsx for its 13 tab-state sections, which
// intentionally stay one page rather than being split into 13 routes —
// splitting them would be exactly the "giant UI rewrite" this milestone
// and Milestone Q before it both warn against, for a page whose content
// components already all work correctly as-is).
export type AdminNavItem = { label: string; href?: string; onClick?: () => void; activeKey?: string };
export type AdminNavSection = { label: string; items: AdminNavItem[] };

const DEFAULT_SECTIONS: AdminNavSection[] = [
  { label: "", items: [{ label: "Overview / Dashboard", href: "/admin" }] },
  {
    label: "Operations",
    items: [
      { label: "Dispatch Control Tower", href: "/admin/dispatch" },
      { label: "Contract Trip Planner", href: "/admin/contract-planner" },
      { label: "Loading Points", href: "/admin/loading-points" },
      { label: "Dispatch (Live)", href: "/dispatch" },
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
      { label: "Scorecards", href: "/admin?tab=scorecards" },
      { label: "Reports", href: "/admin?tab=reports" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Maintenance", href: "/admin?tab=maintenance" },
      { label: "Inventory", href: "/admin?tab=inventory" },
      { label: "ERP Sync", href: "/admin?tab=erp" },
      { label: "Automation", href: "/admin?tab=automation" },
      { label: "Field Ops", href: "/admin?tab=fieldops" },
      { label: "Executive", href: "/admin?tab=executive" },
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
  // /admin/page.tsx passes its own sections (with onClick tab-switches
  // for its 13 in-page sections) and its current `tab` as activeKey.
  // Every other page uses the defaults above, highlighted by pathname.
  sections?: AdminNavSection[];
  activeKey?: string;
  // Preserves the old TopNav's `extra` slot — used by /admin/page.tsx for
  // the platform-admin CompanySwitcher, so that capability isn't lost in
  // this milestone's shell swap.
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

  const sidebarContent = (
    <>
      <div className="px-4 py-4 font-semibold border-b border-white/10 flex items-center justify-between">
        Smarty1
        <button className="md:hidden text-steel hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          ✕
        </button>
      </div>
      <nav className="flex-1 overflow-auto py-2">
        {navSections.map((section, i) => (
          <div key={i} className="mb-3">
            {section.label && <p className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-steel">{section.label}</p>}
            {section.items.map((item, j) => {
              const active = item.activeKey != null ? item.activeKey === activeKey : pathname === item.href;
              const className = `block w-full text-left px-4 py-2 text-sm ${active ? "bg-white/10 text-white font-medium" : "text-steel hover:bg-white/5 hover:text-white"}`;
              if (item.onClick) {
                return (
                  <button
                    key={`${item.label}-${j}`}
                    onClick={() => {
                      item.onClick!();
                      setMobileOpen(false);
                    }}
                    className={className}
                  >
                    {item.label}
                  </button>
                );
              }
              return (
                <a key={item.href ?? item.label} href={item.href} className={className}>
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Desktop sidebar — always visible at md+ per Part 3/4's responsive requirement. */}
      <aside className="hidden md:flex w-56 shrink-0 bg-ink text-white flex-col">{sidebarContent}</aside>

      {/* Mobile drawer — collapses behind a menu button, per Part 4's tablet/mobile requirement. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-ink text-white flex flex-col">{sidebarContent}</aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden text-steel hover:text-ink" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <div className="min-w-0">
              <h1 className="font-medium text-sm truncate">{title}</h1>
              {tenantName && <p className="text-steel text-xs mt-0.5 truncate">{tenantName}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {extra}
            <button onClick={handleLogout} className="text-steel hover:text-ink text-sm">
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
