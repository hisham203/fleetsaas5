## Milestone A — Product Architecture & Enterprise UX Foundation

**Branch:** `milestone-a-product-ux-final`
**Base:** `0f9b8df460eb93136d6bce3fa4dda2e8010edf34` (P2-02 authoritative main)
**Head:** `83489cb362261b1c4c4e142a79d356cbacda4606`
**Files changed:** 22 (19 new, 3 modified)

---

### What this PR delivers

**Architecture**
- `lib/navigation.ts` — single centralized module registry: 8 product domains, 35+ modules, maturity flags (ACTIVE/PARTIAL/FUTURE). All navigation derives from this one source.
- `components/AppShell.tsx` — new enterprise application shell: dual-rail sidebar (domain icon rail + module panel), command palette (⌘K, keyboard navigation, Escape close), notification bell entry point, responsive mobile drawer, top bar with tenant context.
- `components/AdminShell.tsx` — refactored internally to use AppShell navigation architecture. All existing admin pages get the new navigation without a single page-level modification. `DEFAULT_SECTIONS` retained for backward compatibility.
- `components/ds/index.tsx` — 16 shared design-system primitives: `PageHeader`, `MetricCard`, `StatusBadge`, `EntityHeader`, `DescriptionList`, `DataTable`, `Tabs`, `Drawer`, `Btn`, `EmptyState`, `LoadingState`, `FilterBar`, `TimelineItem`, `PageContainer`, `SectionHeader`.

**8-domain product architecture**
Smarty1 is restructured into: Command Center, Operations, Fleet, Telematics, Commercial, Supply Chain, Analytics, Administration. Bulk Water remains the first industry configuration; the platform is industry-agnostic.

**Representative pages (9 domains)**

| Route | Domain | What it does |
|---|---|---|
| `/command` | Command Center | Live metrics (active trips, pending orders, available fleet), quick actions |
| `/dispatch` | Operations | DS modernization: PageHeader, MetricCard KPIs, Btn, LoadingState — all P2-02 business logic unchanged |
| `/operations/trips/[id]` | Operations | Trip 360 entity detail — assignment, stops, lifecycle timeline. Dispatch action retained; Mark Complete removed (called nonexistent endpoint, lifecycle-unsafe) |
| `/fleet/vehicles` | Fleet | Vehicles registry with metrics, filter, status table |
| `/fleet/drivers` | Fleet | Drivers registry with metrics, filter, status table |
| `/fleet/maintenance` | Fleet | Maintenance records for first registered vehicle |
| `/commercial/customers` | Commercial | Customer search and table |
| `/supply-chain/inventory` | Supply Chain | Inventory balances with stock-level status badges |
| `/analytics/reports` | Analytics | Report list with run action |
| `/administration/users` | Administration | User list, read-only with link to full `/settings/access` |

**Root routing:** ADMIN role now routes to `/command` instead of `/admin`.

**Documentation (4 new docs in `docs/product/`)**
- `SMARTY1-PRODUCT-ARCHITECTURE.md` — domain ownership rules, module taxonomy, multi-industry principle
- `SMARTY1-CAPABILITY-GAP-MATRIX.md` — every capability × status × priority × milestone
- `capability-inventory.md` — per-capability inventory with routes and APIs
- `route-map.md` — dispatch surface clarification, inventory overlap doc, placeholder route status

---

### What is NOT in this PR

- No `bafc30d` (infrastructure hardening) — that is a separate reviewable delivery
- No database migration (migration 0025 present, 0026 absent)
- No business logic changes (pricing, billing, POD, dispatch semantics, RBAC, ERP)
- No P2-03
- No LEGACY_PERMISSIONS removal

---

### Validation

| Check | Result |
|---|---|
| Tests × 3 | ✅ 1943/1943 — 116 files |
| `npm run security:api` | ✅ 0 sensitive field exposures |
| `npm run audit:rbac` | ✅ 176 classified, 0 uncovered |
| `npm run lint` | ✅ 0 errors |
| App-source TypeScript | ✅ 0 errors |
| Historical test TypeScript debt | 470 pre-existing errors in `tests/` (unchanged from baseline) |
| `npm run build` | ✅ Clean |
| P2-02 regression | ✅ All golden-path tests pass |
| Migration 0026 | ✅ Absent |
| Production DB migration | ✅ None required |
| LEGACY_PERMISSIONS | ✅ Preserved |
| bafc30d excluded | ✅ Confirmed — `git merge-base --is-ancestor bafc30d HEAD` exits non-zero |

---

### Pending after merge

**Browser visual UAT** is required before production release. Once Coolify deploys to `demo.smarty1.com`, walk:

**Desktop (1440px):** `/command`, `/dispatch`, `/fleet/vehicles`, `/fleet/drivers`, `/fleet/maintenance`, `/commercial/customers`, `/supply-chain/inventory`, `/analytics/reports`, `/administration/users`, `/operations/trips/[id]`

**Mobile (390px):** navigation drawer open, `/command`, `/dispatch`, `/fleet/vehicles`, `/operations/trips/[id]`

Check: navigation active states, breadcrumbs, tables overflow, status badges, command palette (⌘K), mobile drawer, no horizontal scroll, maps on `/dispatch`.
