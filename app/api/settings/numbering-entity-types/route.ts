export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole } from "@/lib/auth";
import { NUMBERING_ENTITY_TYPES } from "@/lib/numbering";

// Milestone AD — returns the static entity-type/recommended-prefix
// registry. Validation/UI defaults only, not tenant configuration —
// still requires auth like every other Settings route, but has no
// tenant-scoped data to isolate (the registry itself is the same for
// every tenant; what each tenant configures from it is not stored yet).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(NUMBERING_ENTITY_TYPES);
}
