export const dynamic = "force-dynamic";
/**
 * POST /api/telematics/providers/[id]/token
 * Generate or rotate the webhook token for a Teltonika provider.
 *
 * The plaintext token is returned ONCE. Only the bcrypt hash is stored.
 * Rotation invalidates the previous token immediately.
 *
 * Security: ADMIN + TENANT_SETTINGS only.
 * The response body MUST be treated as sensitive. Log it and close the modal.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsProviders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";
import { generateWebhookToken, hashWebhookToken } from "@/lib/webhookToken";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized — ADMIN only" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TENANT_SETTINGS);
  if (deny) return deny;

  const provider = await db.query.telematicsProviders.findFirst({
    where: and(eq(telematicsProviders.id, id), eq(telematicsProviders.tenantId, tenantId)),
    columns: { id: true, providerType: true },
  });
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  if (provider.providerType !== "HARDWARE_DEVICE") {
    return NextResponse.json(
      { error: "Webhook tokens are only for HARDWARE_DEVICE providers" },
      { status: 422 }
    );
  }

  // Generate plaintext token and hash for storage:
  const plaintext = generateWebhookToken();
  const hash = await hashWebhookToken(plaintext);

  await db.update(telematicsProviders)
    .set({ webhookTokenHash: hash } as any)
    .where(eq(telematicsProviders.id, id));

  console.log(JSON.stringify({
    level: "info", event: "provider.token.rotated",
    providerId: id, tenantId,
    // plaintext NEVER logged
  }));

  return NextResponse.json({
    token: plaintext,                                        // shown ONCE
    webhookUrl: `/api/inbound/teltonika/${plaintext}`,       // pre-built for the operator
    warning: "Copy this token now. It will not be shown again.",
  });
}
