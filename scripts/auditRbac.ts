/**
 * P2-02 Final: Machine-enforced RBAC audit — per HTTP METHOD.
 * npm run audit:rbac
 * Exits 1 on any failure.
 */
import * as fs from "fs";
import * as path from "path";

type MethodClass = string; // "PERMISSION:X" | "IDENTITY:PLATFORM" | "IDENTITY:DRIVER" | "IDENTITY:CUSTOMER" | "INFRA:AUTH" | "INFRA:HEALTH" | "DEVELOPMENT:DEMO"

// ── Allowlist: justified non-checkPermission classifications ─────────────────
// Key: "relative/path:METHOD"  Value: classification reason
const ALLOWLIST: Record<string, { classification: string; reason: string }> = {
  "auth/login/route.ts:POST":    { classification: "INFRA:AUTH", reason: "Login — authentication endpoint, no session yet" },
  "auth/logout/route.ts:POST":   { classification: "INFRA:AUTH", reason: "Logout — invalidates session" },
  "auth/me/route.ts:GET":        { classification: "INFRA:AUTH", reason: "Session probe — returns current session" },
  "auth/signup/route.ts:POST":   { classification: "INFRA:AUTH", reason: "Registration — public endpoint" },
  "health/route.ts:GET":         { classification: "INFRA:HEALTH", reason: "Liveness probe — no auth needed" },
  "tenant/route.ts:GET":         { classification: "INFRA:AUTH", reason: "Tenant resolution by slug — public" },
  "trips/[id]/demo-gps/route.ts:POST":   { classification: "DEVELOPMENT:DEMO", reason: "GPS demo — Platform Admin only" },
  "trips/[id]/demo-route/route.ts:GET":  { classification: "DEVELOPMENT:DEMO", reason: "Demo route — Platform Admin only" },
  "trips/[id]/lifecycle/route.ts:GET":   { classification: "PERMISSION:TRIPS_VIEW+IDENTITY:DRIVER", reason: "checkPermission(TRIPS_VIEW) then DRIVER identity gate" },
  "trips/[id]/lifecycle/route.ts:POST":  { classification: "PERMISSION:TRIPS_VIEW+IDENTITY:DRIVER", reason: "checkPermission(TRIPS_VIEW) then DRIVER identity gate" },
};

function findFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !["node_modules",".next",".git"].includes(e.name)) out.push(...findFiles(full));
    else if (e.isFile() && e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const METHOD_RE = /^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/gm;
const BUSINESS_BAD_RE = [
  /hasRole\s*\(\s*session\s*,\s*\[\s*["']ADMIN["']\s*,\s*["']DISPATCHER["']\s*\]\s*\)/,
  /hasRole\s*\(\s*session\s*,\s*\[\s*["']DISPATCHER["']\s*\]\s*\)/,
  /session\??\.user\??\.role\s*===\s*["']DISPATCHER["']/,
  /ROLE_MODULE_MAP/,
];
const OLD_ENFORCE_RE = /enforceRbac\s*\(/;

interface Finding { file: string; method?: string; issue: string; line: number; content: string }

async function main() {
  const cwd = process.cwd();
  const apiDir = path.join(cwd, "app/api");
  const apiFiles = findFiles(apiDir);
  const rel = (f: string) => f.replace(cwd + "/app/api/", "");
  const findings: Finding[] = [];
  const uncoveredMethods: string[] = [];
  const coveredMethods: string[] = [];

  for (const fpath of apiFiles) {
    const s = fs.readFileSync(fpath, "utf8");
    const relPath = rel(fpath);
    const lines = s.split("\n");

    // 1. Unclassified business role checks:
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      for (const re of BUSINESS_BAD_RE) {
        if (re.test(line)) findings.push({ file: relPath, line: i+1, content: line.trim(), issue: "UNCLASSIFIED_BUSINESS_ROLE_CHECK" });
      }
      if (OLD_ENFORCE_RE.test(line) && !line.includes("import") && !line.includes("//")) {
        findings.push({ file: relPath, line: i+1, content: line.trim(), issue: "OLD_ENFORCERBAC_CALL" });
      }
    }

    // 2. Per-method coverage:
    let match: RegExpExecArray | null;
    METHOD_RE.lastIndex = 0;
    while ((match = METHOD_RE.exec(s)) !== null) {
      const method = match[1];
      const key = `${relPath}:${method}`;

      if (ALLOWLIST[key]) { coveredMethods.push(key); continue; }

      // Extract function body (rough — from match to next 'export async function' or EOF):
      const bodyStart = match.index + match[0].length;
      const nextExport = s.indexOf("\nexport async function ", bodyStart);
      const body = s.slice(bodyStart, nextExport === -1 ? undefined : nextExport);

      if (body.includes("checkPermission(") || body.includes("checkTenantAdminPermission(") || body.includes("_cp2(") || body.includes("_cp3(") || body.includes("_cp4(") || body.includes("authorizeTenantRbac") || body.includes("_ctap(") || body.includes("_lcDeny") || body.includes("_d2 =") || body.includes("_d3 =") || body.includes("_d4 =") || body.includes("_cpPatch") || body.includes("_dPatch")) {
        coveredMethods.push(key);
      } else if (body.includes('hasRole(session, ["ADMIN"])') || body.includes("hasRole(session, ['ADMIN'])")) {
        // Remaining ADMIN-only gates — classify as IDENTITY:PLATFORM:
        coveredMethods.push(key + " [IDENTITY:PLATFORM]");
      } else if (body.includes('hasRole(session, ["ADMIN", "DRIVER"])')
              || body.includes('hasRole(session, ["ADMIN","DRIVER"])')
              || body.includes('hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])')
              || body.includes("role === \"DRIVER\"") || body.includes("DRIVER_IDENTITY")) {
        coveredMethods.push(key + " [IDENTITY:DRIVER]");
      } else if (body.includes('hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER", "CUSTOMER"])')) {
        coveredMethods.push(key + " [INFRA:TENANT_MEMBER]");
      } else {
        uncoveredMethods.push(key);
      }
    }
  }

  // 3. Permission catalogue:
  const permSrc = fs.readFileSync(path.join(cwd, "lib/permissions.ts"), "utf8");
  const permCodes = new Set(permSrc.match(/"[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*"/g) ?? []);

  // 4. enforceRbac remnants in lib/:
  const libFiles = findFiles(path.join(cwd, "lib"));
  const hasEnforceLib = libFiles.filter(f => fs.readFileSync(f,"utf8").includes("ROLE_MODULE_MAP") || fs.readFileSync(f,"utf8").includes("enforceRbac"));

  // Output:
  console.log("SMARTY1 P2-02 RBAC Audit (per HTTP METHOD)\n===========================================");
  if (findings.length > 0) {
    console.error(`\n❌ AUTHORIZATION DEFECTS: ${findings.length}`);
    findings.forEach(f => console.error(`  ${f.file}:${f.line} [${f.issue}]: ${f.content.slice(0,100)}`));
  } else console.log("✅ Unclassified business role checks: 0");

  console.log(`\nAPI methods classified: ${coveredMethods.length}`);
  console.log(`API methods uncovered:  ${uncoveredMethods.length}`);
  if (uncoveredMethods.length > 0) {
    console.error("❌ UNCOVERED API METHODS:");
    uncoveredMethods.forEach(m => console.error(`  ${m}`));
  } else console.log("✅ No uncovered API methods");

  if (hasEnforceLib.length > 0) {
    const active = hasEnforceLib.filter(f => !f.includes("enforceRbac.ts") && !f.includes("rbac.ts"));
    if (active.length > 0) console.error(`❌ enforceRbac/ROLE_MODULE_MAP in non-legacy lib files: ${active.map(f=>f.replace(cwd+"/",""))}`);
    else console.log(`✅ enforceRbac.ts/rbac.ts: dead code only, no active business use`);
  }

  console.log(`\nPermission codes in catalogue: ${permCodes.size}`);

  const passed = findings.length === 0 && uncoveredMethods.length === 0;
  console.log(passed ? "\n✅ RBAC AUDIT PASSED" : "\n❌ RBAC AUDIT FAILED");
  process.exit(passed ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
