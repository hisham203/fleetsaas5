"use client";

import { usePathname, useRouter } from "next/navigation";

// Milestone Q, Gate Q3 — reusable Admin shell (persistent sidebar + light
// workspace), applied to the new modules this milestone introduces
// (Dispatch Control Tower, Contract Planner, Loading Points) per Gate
// Q3's own instruction: "Apply first to Dashboard where safe, Dispatch
// Control Tower, Contract Planner, Loading Points. Existing modules can
// migrate incrementally." The existing /admin, /admin/contracts,
// /admin/customers, /dispatch, and /driver pages are deliberately left
// exactly as they are — each keeps its own working TopNav-based layout,
// avoiding "a giant UI rewrite" this task explicitly warns against.
// Deep links to every existing route are preserved unchanged; this shell
// only adds new navigation, it never removes or renames anything.
const NAV_SECTIONS: { label: string; items: { label: string; href: string }[] }[] = [
  { label: "", items: [{ label: "Dashboard", href: "/admin" }] },
  {
    label: "Operations",
    items: [
      { label: "Dispatch Control Tower", href: "/admin/dispatch" },
      { label: "Contract Planner", href: "/admin/contract-planner" },
      { label: "Dispatch (Live)", href: "/dispatch" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { label: "Contracts", href: "/admin/contracts" },
      { label: "Customers & Sites", href: "/admin/customers" },
    ],
  },
  {
    label: "Network / Resources",
    items: [{ label: "Loading Points", href: "/admin/loading-points" }],
  },
];

export default function AdminShell({
  title,
  tenantName,
  children,
}: {
  title: string;
  tenantName?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-paper flex">
      <aside className="w-56 shrink-0 bg-ink text-white flex flex-col">
        <div className="px-4 py-4 font-semibold border-b border-white/10">Smarty1</div>
        <nav className="flex-1 overflow-auto py-2">
          {NAV_SECTIONS.map((section, i) => (
            <div key={i} className="mb-3">
              {section.label && <p className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-steel">{section.label}</p>}
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`block px-4 py-2 text-sm ${active ? "bg-white/10 text-white font-medium" : "text-steel hover:bg-white/5 hover:text-white"}`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-medium text-sm">{title}</h1>
            {tenantName && <p className="text-steel text-xs mt-0.5">{tenantName}</p>}
          </div>
          <button onClick={handleLogout} className="text-steel hover:text-ink text-sm">
            Log out
          </button>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
