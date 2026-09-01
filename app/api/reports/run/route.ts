export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runReport, toCsv } from "@/lib/reportQuery";
import { z } from "zod";

const filterSchema = z.object({
  column: z.string(),
  operator: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number()]),
});

const runSchema = z.object({
  datasetKey: z.string(),
  config: z.object({
    columns: z.array(z.string()).default([]),
    filters: z.array(filterSchema).default([]),
    sort: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().optional(),
  }),
  format: z.enum(["json", "csv"]).default("json"),
});

// BR-21 Custom Report Builder — runs a report against a whitelisted dataset
// (see lib/reportDatasets.ts) for the caller's own tenant. Works for both
// ad-hoc "preview" runs from the builder UI and re-running a saved report
// (the client just re-sends that report's stored config).
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runReport(parsed.data.datasetKey, tenantId, parsed.data.config);

    if (parsed.data.format === "csv") {
      const csv = toCsv(result);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${parsed.data.datasetKey}-report.csv"`,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report failed" }, { status: 400 });
  }
}
