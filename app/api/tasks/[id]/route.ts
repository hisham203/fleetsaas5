export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  action: z.enum(["START", "COMPLETE", "CANCEL"]),
  completionNotes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)) });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // A driver can only progress their own task; only ADMIN/DISPATCHER can cancel.
  if (session!.type === "USER" && session!.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session!.user.id) });
    if (!driverProfile || driverProfile.id !== task.driverId) {
      return NextResponse.json({ error: "Not your task" }, { status: 403 });
    }
    if (parsed.data.action === "CANCEL") {
      return NextResponse.json({ error: "Only Admin/Dispatcher can cancel a task" }, { status: 403 });
    }
  }

  if (parsed.data.action === "START") {
    if (task.status !== "ASSIGNED") return NextResponse.json({ error: "Only an ASSIGNED task can be started" }, { status: 422 });
    await db.update(tasks).set({ status: "IN_PROGRESS", startedAt: new Date() }).where(eq(tasks.id, task.id));
  } else if (parsed.data.action === "COMPLETE") {
    if (task.status !== "IN_PROGRESS" && task.status !== "ASSIGNED") {
      return NextResponse.json({ error: "Task is not in a state that can be completed" }, { status: 422 });
    }
    await db
      .update(tasks)
      .set({ status: "COMPLETED", completedAt: new Date(), completionNotes: parsed.data.completionNotes })
      .where(eq(tasks.id, task.id));
  } else {
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      return NextResponse.json({ error: "Task is already closed" }, { status: 422 });
    }
    await db.update(tasks).set({ status: "CANCELLED" }).where(eq(tasks.id, task.id));
  }

  const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
  return NextResponse.json(updated);
}
