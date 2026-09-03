import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { scan } from "../../scripts/checkSensitiveExposure";

// Task S2 — proves the CI guard actually catches what it claims to,
// using real temporary files (never written into the real app/api tree,
// and always cleaned up) rather than trusting the implementation by
// reading it. scan() accepts a root directory specifically so it can be
// pointed at an isolated scratch directory here.
describe("checkSensitiveExposure guard", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function makeScratchFile(content: string): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "s2-guard-test-"));
    const file = path.join(tmpDir, "route.ts");
    fs.writeFileSync(file, content);
    return tmpDir;
  }

  it("passes on the current real codebase (app/api/**) — no findings", () => {
    const findings = scan();
    expect(findings).toEqual([]);
  });

  it("flags `user: true`", () => {
    const root = makeScratchFile(`export async function GET() {
  const rows = await db.query.drivers.findMany({ with: { user: true } });
  return NextResponse.json(rows);
}
`);
    const findings = scan(root);
    expect(findings.length).toBe(1);
    expect(findings[0].pattern.label).toBe("user: true");
  });

  it("flags `customer: true`", () => {
    const root = makeScratchFile(`with: { customer: true },`);
    const findings = scan(root);
    expect(findings.some((f) => f.pattern.label === "customer: true")).toBe(true);
  });

  it("flags nested `driver: { with: { user: true } } }`", () => {
    const root = makeScratchFile(`with: { driver: { with: { user: true } }, vehicle: true },`);
    const findings = scan(root);
    expect(findings.some((f) => f.pattern.label === "user: true")).toBe(true);
  });

  it("flags `...user` and `...customer` spreads", () => {
    const root = makeScratchFile(`return NextResponse.json({ ...user, extra: 1 });\nconst x = { ...customer };`);
    const findings = scan(root);
    expect(findings.some((f) => f.pattern.label === "...user")).toBe(true);
    expect(findings.some((f) => f.pattern.label === "...customer")).toBe(true);
  });

  it("flags `createdBy: true` and `updatedBy: true`", () => {
    const root = makeScratchFile(`with: { createdBy: true, updatedBy: true },`);
    const findings = scan(root);
    expect(findings.some((f) => f.pattern.label === "createdBy: true")).toBe(true);
    expect(findings.some((f) => f.pattern.label === "updatedBy: true")).toBe(true);
  });

  it("flags passwordHash reaching a NextResponse.json(...) call", () => {
    const root = makeScratchFile(`return NextResponse.json({ id: user.id, passwordHash: user.passwordHash });`);
    const findings = scan(root);
    expect(findings.some((f) => f.pattern.label === "passwordHash")).toBe(true);
  });

  it("does NOT flag passwordHash used for internal auth logic (login/signup/insert), matching real S1-audited code", () => {
    const root = makeScratchFile(`
const ok = await verifyPassword(password, user.passwordHash);
const passwordHash = await hashPassword(data.password);
await db.insert(users).values({ id, tenantId, passwordHash });
function toSafeUser<T extends { passwordHash?: string | null }>(u: T) {
  const { passwordHash, ...safe } = u;
  return safe;
}
`);
    const findings = scan(root);
    expect(findings).toEqual([]);
  });

  it("does not flag a whole-line explanatory comment mentioning these patterns", () => {
    const root = makeScratchFile(`// This route previously used user: true and exposed passwordHash — fixed below.
with: { user: { columns: SAFE_USER_COLUMNS } },`);
    const findings = scan(root);
    expect(findings).toEqual([]);
  });

  it("honors an explicit SECURITY_EXPOSURE_CHECK_ALLOW comment on the line above", () => {
    const root = makeScratchFile(`// Verified safe elsewhere — only .name is ever read. SECURITY_EXPOSURE_CHECK_ALLOW
with: { customer: true },`);
    const findings = scan(root);
    expect(findings).toEqual([]);
  });

  it("returns no findings for a nonexistent root (defensive, not a crash)", () => {
    const findings = scan(path.join(os.tmpdir(), "definitely-does-not-exist-" + Date.now()));
    expect(findings).toEqual([]);
  });
});
