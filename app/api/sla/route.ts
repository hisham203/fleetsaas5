export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { computeSlaStatus } from "@/lib/sla";
import { checkAndCreateEscalations } from "@/lib/escalations";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, notInArray, and } from "drizzle-orm";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// BR-20: SLA & Escalation Management — returns every order with its computed
// due time and current SLA status, so the dispatcher can see what's at risk
// or already breached without waiting for a background job. Also runs the
// automatic escalation check (lib/escalations.ts) as a side effect, since
// this endpoint is already polled continuously by the Dispatcher console —
// that polling is what makes escalation creation effectively automatic.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.REPORTS_OPERATIONS_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.REPORTS_OPERATIONS_VIEW); if (_permDeny2) return _permDeny2;

  await checkAndCreateEscalations(tenantId);

  const rows = await db.query.orders.findMany({
    where: and(eq(orders.tenantId, tenantId), notInArray(orders.status, ["CANCELLED"])),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } },
  });

  const withSla = rows.map((o) => ({
    ...o,
    ...computeSlaStatus({
      createdAt: o.createdAt,
      slaMinutes: o.slaMinutes,
      status: o.status,
      completedAt: o.completedAt,
    }),
  }));

  const summary = {
    onTrack: withSla.filter((o) => o.slaStatus === "ON_TRACK").length,
    atRisk: withSla.filter((o) => o.slaStatus === "AT_RISK").length,
    breached: withSla.filter((o) => o.slaStatus === "BREACHED").length,
    met: withSla.filter((o) => o.slaStatus === "MET").length,
    missed: withSla.filter((o) => o.slaStatus === "MISSED").length,
  };

  // Most urgent first: breached, then at-risk, then on-track, then resolved.
  const priority: Record<string, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, MISSED: 3, MET: 4 };
  withSla.sort((a, b) => priority[a.slaStatus] - priority[b.slaStatus] || a.minutesRemaining - b.minutesRemaining);

  return NextResponse.json({ orders: withSla, summary });
}
