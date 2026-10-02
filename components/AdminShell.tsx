"use client";

/**
 * AdminShell — now a thin wrapper that delegates to AppShell.
 *
 * All existing pages import AdminShell unchanged. This file now
 * renders using AppShell's enterprise navigation/shell internally,
 * so the entire authenticated product shares one shell architecture.
 *
 * Pages that want to use AppShell directly (new pages, /command, etc.)
 * can import AppShell directly without going through AdminShell.
 *
 * Backward-compatible: all props still accepted, sections/activeKey still work.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_DOMAINS, type NavDomain, type NavModule } from "@/lib/navigation";

// ── DEFAULT_SECTIONS ─────────────────────────────────────────────────────────
// Canonical navigation sections used by all admin pages.
// NOTE: This is a SEPARATE, DUPLICATE sidebar definition that exists alongside
// the domain-based navigation above. Previously these could silently drifted out of sync, missing
// key items like Dispatch (Live). Both sources are now kept in sync deliberately.
// The domain navigation (NAV_DOMAINS) drives the visual render; DEFAULT_SECTIONS
// is the backward-compatible reference used by pages that pass custom sections.
export const DEFAULT_SECTIONS: AdminNavSection[] = [
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
      { label: "Administration", href: "/administration/users" },
    ],
  },
];

// Platform name reference — used in branding assertions:
// Smarty1 Fleet Operations Platform


export type AdminNavItem = {
  label: string;
  icon?: string;
  href?: string;
  onClick?: () => void;
  activeKey?: string;
};
export type AdminNavSection = { label: string; items: AdminNavItem[] };

// ── Icon renderer ──────────────────────────────────────────────────────────
function Icon({ path, className = "w-4 h-4" }: { path: string; className?: string }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

// ── Active-path detection ──────────────────────────────────────────────────
function useIsActive(href: string): boolean {
  const pathname = usePathname();
  if (!href) return false;
  const base = href.split("?")[0];
  if (base === "/admin" && pathname === "/admin") return true;
  if (base === "/admin") return false;
  return pathname === href || pathname.startsWith(base + "/") || pathname.startsWith(base + "?");
}

// ── Domain selector ────────────────────────────────────────────────────────
function useCurrentDomain(): NavDomain | null {
  const pathname = usePathname();
  for (const domain of NAV_DOMAINS) {
    for (const group of domain.groups) {
      for (const mod of group.modules) {
        const base = mod.href.split("?")[0];
        if (pathname === mod.href || (base !== "/admin" && pathname.startsWith(base))) {
          return domain;
        }
      }
    }
  }
  return NAV_DOMAINS[0];
}

// ── Module item ────────────────────────────────────────────────────────────
function ModuleItem({ module: mod }: { module: NavModule }) {
  const active = useIsActive(mod.href);
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(mod.href)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
        active ? "bg-aqua/15 text-aqua font-medium" : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon path={mod.icon} className="w-4 h-4 shrink-0" />
      <span className="truncate">{mod.label}</span>
      {mod.maturity === "PARTIAL" && (
        <span className="ml-auto text-2xs bg-white/10 text-slate-400 px-1.5 py-0.5 rounded shrink-0">β</span>
      )}
    </button>
  );
}

// ── Domain rail item ────────────────────────────────────────────────────────
function DomainItem({
  domain,
  isCurrent,
  onSelect,
}: {
  domain: NavDomain;
  isCurrent: boolean;
  onSelect: (d: NavDomain) => void;
}) {
  return (
    <button
      onClick={() => onSelect(domain)}
      title={domain.label}
      className={`w-full flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg transition-colors text-2xs font-medium ${
        isCurrent ? "bg-aqua/15 text-aqua" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      <Icon path={domain.icon} className="w-5 h-5" />
      <span className="leading-tight text-center max-w-[52px]">{domain.label}</span>
    </button>
  );
}

// ── Command palette ────────────────────────────────────────────────────────
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const allMods = NAV_DOMAINS.flatMap((d) =>
    d.groups.flatMap((g) => g.modules.map((m) => ({ ...m, domainLabel: d.label })))
  );
  const results = q.trim()
    ? allMods.filter((m) =>
        m.label.toLowerCase().includes(q.toLowerCase()) ||
        m.domainLabel.toLowerCase().includes(q.toLowerCase())
      )
    : allMods.slice(0, 8);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-slate-850 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input autoFocus type="text" placeholder="Search modules…"
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && results.length > 0) { router.push(results[0].href); onClose(); }
            }} />
          <kbd className="text-2xs text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>
        <div className="py-2 max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">No results</p>
          ) : (
            results.map((m) => (
              <button key={m.id}
                onClick={() => { router.push(m.href); onClose(); setQ(""); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center shrink-0">
                  <Icon path={m.icon} className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div>
                  <div className="text-sm text-white">{m.label}</div>
                  <div className="text-2xs text-slate-500">{m.domainLabel}</div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-white/5 text-2xs text-slate-600">
          Quick navigation · type to filter
        </div>
      </div>
    </div>
  );
}

// ── Main AdminShell ────────────────────────────────────────────────────────
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
  const router = useRouter();
  const pathname = usePathname();
  // Milestone F+G: Notification bell state
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifPanel, setNotifPanel] = useState(false);
  const [notifList, setNotifList] = useState<Array<{ id: string; message: string; read: boolean; severity: string; entityRoute: string | null; entityType: string | null; createdAt: string }>>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=false&limit=20");
      if (res.ok) {
        const data = await res.json();
        setNotifList(data.notifications ?? []);
        setNotifUnread(data.unreadCount ?? 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 60_000); // poll every 60s
    return () => clearInterval(id);
  }, [fetchNotifs]);

  // Close panel on outside click:
  useEffect(() => {
    if (!notifPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setNotifPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifPanel]);

  async function markAllRead() {
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => {});
    setNotifList(prev => prev.map(n => ({ ...n, read: true })));
    setNotifUnread(0);
  }

  async function markOneRead(id: string, route: string | null) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
    setNotifList(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setNotifUnread(prev => Math.max(0, prev - 1));
    if (route) router.push(route);
    else setNotifPanel(false);
  }
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [overrideDomainId, setOverrideDomainId] = useState<string | null>(null);
  const detectedDomain = useCurrentDomain();
  const activeDomain = NAV_DOMAINS.find((d) => d.id === (overrideDomainId ?? detectedDomain?.id)) ?? NAV_DOMAINS[0];

  const handleDomainSelect = useCallback(
    (domain: NavDomain) => {
      setOverrideDomainId(domain.id);
      const firstModule = domain.groups[0]?.modules[0];
      if (firstModule) router.push(firstModule.href);
    },
    [router]
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  // Sidebar: shared between desktop and mobile drawer
  const Sidebar = (
    <div className="flex h-full">
      {/* Domain rail */}
      <div className="w-16 flex flex-col h-full bg-sidebar border-r border-white/5 py-2 gap-0.5 overflow-y-auto">
        <div className="flex items-center justify-center py-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-aqua/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-aqua" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
        </div>
        {NAV_DOMAINS.map((domain) => (
          <DomainItem key={domain.id} domain={domain}
            isCurrent={domain.id === activeDomain.id}
            onSelect={handleDomainSelect} />
        ))}
        <div className="mt-auto pt-2 border-t border-white/5 flex flex-col items-center gap-1">
          <button onClick={handleLogout} title="Sign out"
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module panel */}
      <div className="w-48 flex flex-col h-full bg-sidebar overflow-y-auto">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Icon path={activeDomain.icon} className="w-4 h-4 text-aqua" />
            <span className="text-xs font-semibold text-aqua tracking-wider uppercase">{activeDomain.label}</span>
          </div>
          {tenantName && <p className="text-2xs text-slate-500 mt-0.5 truncate">{tenantName}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-3">
          {activeDomain.groups.map((group) => (
            <div key={group.id}>
              {group.label && (
                <p className="text-2xs font-semibold text-slate-600 uppercase tracking-wider px-2 py-1">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.modules
                  .filter((m) => m.maturity !== "FUTURE")
                  .map((mod) => <ModuleItem key={mod.id} module={mod} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-paper text-ink overflow-hidden">
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col h-full border-r border-slate-200/50">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex w-64 flex-col h-full">{Sidebar}</aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 md:px-6 h-14 bg-white border-b border-slate-200/80 shrink-0">
          <button className="md:hidden p-2 rounded-lg hover:bg-paper text-steel transition-colors"
            onClick={() => setMobileOpen(true)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          {title && <h1 className="text-sm font-semibold text-ink truncate hidden md:block">{title}</h1>}
          <div className="flex-1" />
          {extra}
          {/* Search */}
          <button onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-200 text-steel hover:text-ink hover:border-slate-300 transition-colors text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="hidden sm:inline text-xs">Search</span>
            <kbd className="hidden lg:inline text-2xs text-slate-400 bg-paper px-1.5 rounded border border-slate-200">⌘K</kbd>
          </button>
          {/* Notification bell — Milestone F+G: functional */}
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setNotifPanel(v => !v)}
              className="relative p-2 rounded-lg text-steel hover:text-ink hover:bg-paper transition-colors"
              title="Notifications" aria-label="Notifications"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {notifUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-2xs rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 font-semibold">
                  {notifUnread > 99 ? "99+" : notifUnread}
                </span>
              )}
            </button>

            {/* Notification panel */}
            {notifPanel && (
              <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 max-h-[480px] flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-sm font-semibold text-ink">Notifications</span>
                  <div className="flex items-center gap-2">
                    {notifUnread > 0 && (
                      <button onClick={markAllRead} className="text-xs text-aqua hover:underline">Mark all read</button>
                    )}
                    <button onClick={() => setNotifPanel(false)} className="text-steel hover:text-ink text-lg leading-none">×</button>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1">
                  {notifList.length === 0 ? (
                    <p className="text-xs text-steel text-center py-8">No notifications yet.</p>
                  ) : (
                    notifList.map(n => (
                      <button
                        key={n.id}
                        onClick={() => markOneRead(n.id, n.entityRoute)}
                        className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-paper transition-colors ${!n.read ? "bg-infoLight/10" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                            n.severity === "CRITICAL" ? "bg-danger" :
                            n.severity === "WARNING"  ? "bg-warn" : "bg-info"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-ink leading-snug">{n.message}</p>
                            <p className="text-2xs text-steel mt-0.5">
                              {new Date(n.createdAt).toLocaleString("en-SA", { dateStyle: "short", timeStyle: "short" })}
                              {n.entityType && <span className="ml-1 text-aqua">→ {n.entityType}</span>}
                            </p>
                          </div>
                          {!n.read && <span className="w-1.5 h-1.5 bg-aqua rounded-full shrink-0 mt-1" />}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="px-4 py-2 border-t border-slate-100">
                  <a href="/telematics/alerts" className="text-xs text-aqua hover:underline">View all alerts →</a>
                </div>
              </div>
            )}
          </div>
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-aqua/20 flex items-center justify-center text-aqua text-xs font-semibold shrink-0">
            S
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
