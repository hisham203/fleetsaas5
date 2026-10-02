export const dynamic = "force-dynamic";
/**
 * GET  /api/telematics/providers/[id] — get provider details
 * POST /api/telematics/providers/[id]/token — handled in sub-route
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsProviders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TENANT_SETTINGS);
  if (deny) return deny;

  const provider = await db.query.telematicsProviders.findFirst({
    where: and(eq(telematicsProviders.id, id), eq(telematicsProviders.tenantId, tenantId)),
    columns: { id: true, name: true, providerType: true, status: true,
               // webhookTokenHash deliberately excluded from response:
               config: true, createdAt: true },
  });
  if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Indicate whether a token is configured (without exposing the hash):
  const full = await db.query.telematicsProviders.findFirst({
    where: and(eq(telematicsProviders.id, id), eq(telematicsProviders.tenantId, tenantId)),
    columns: { webhookTokenHash: true },
  });
  return NextResponse.json({ ...provider, hasWebhookToken: !!full?.webhookTokenHash });
}
