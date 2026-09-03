// Task S2 — CI guard against reintroducing the sensitive-field-exposure
// pattern fixed in Task S1. Not a full AST analyzer — a targeted,
// comment-aware regex scan of app/api/** only, kept deliberately simple
// per this task's own guidance: reliable and low-noise beats clever.
//
// Scope is app/api/**/*.ts(x) only, on purpose:
//   - lib/** legitimately embeds `user: true` / `customer: true` in
//     several places (lib/scorecards.ts, lib/reportQuery.ts,
//     lib/erp/sync.ts) — every one individually audited in Task S1 and
//     confirmed safe, because each flattens the embed to named fields
//     (e.g. `driverName: d.user.name`) before anything reaches an API
//     response. Scanning lib/** with this same regex would flag all of
//     them as false positives; app/api/** is where a raw embed can
//     reach `NextResponse.json()` directly, which is the actual risk.
//   - tests/** legitimately assert `expect(text).not.toContain(
//     "passwordHash")` and similar — exactly the opposite of a real
//     exposure, and excluded by scope rather than needing pattern-level
//     cleverness to distinguish.
//
// Comment-handling: every explanatory comment in this codebase (see the
// S1 fix commits) is written as whole `//`-prefixed lines, never
// `/* */` blocks — this script strips exactly that style. It is not a
// general-purpose JS/TS comment stripper (it doesn't need to be, given
// what's actually in this repository), and that limitation is
// deliberate, not an oversight.

import fs from "fs";
import path from "path";

const SCAN_ROOT = path.join(process.cwd(), "app", "api");
const ALLOW_COMMENT = "SECURITY_EXPOSURE_CHECK_ALLOW";

type Pattern = {
  label: string;
  regex: RegExp;
  reason: string;
  fix: string;
  // Optional extra check on the raw (non-comment-stripped) line — used
  // only by the passwordHash pattern, to recognize the one legitimate
  // shape (destructure-and-discard) without a broad allowlist.
  allowIf?: (rawLine: string) => boolean;
};

const PATTERNS: Pattern[] = [
  {
    label: "user: true",
    regex: /\buser\s*:\s*true\b/,
    reason: "returns every column on the related user row, including passwordHash",
    fix: "Use SAFE_USER_COLUMNS from lib/contractHelpers.ts, e.g. { columns: SAFE_USER_COLUMNS }, instead of `user: true`.",
  },
  {
    label: "customer: true",
    regex: /\bcustomer\s*:\s*true\b/,
    reason: "returns every column on the related customer row, including passwordHash",
    fix: "Use SAFE_CUSTOMER_COLUMNS from lib/contractHelpers.ts, e.g. { columns: SAFE_CUSTOMER_COLUMNS }, instead of `customer: true`.",
  },
  {
    label: "createdBy: true",
    regex: /\bcreatedBy\s*:\s*true\b/,
    reason: "likely eager-loads a user relation with every column, including passwordHash",
    fix: "Select explicit safe columns instead of eager-loading the full related row.",
  },
  {
    label: "updatedBy: true",
    regex: /\bupdatedBy\s*:\s*true\b/,
    reason: "likely eager-loads a user relation with every column, including passwordHash",
    fix: "Select explicit safe columns instead of eager-loading the full related row.",
  },
  {
    label: "...user",
    regex: /\.\.\.user\b/,
    reason: "spreads every column from a user object into a response, including passwordHash",
    fix: "Return an explicitly constructed safe object instead of spreading the full user record.",
  },
  {
    label: "...customer",
    regex: /\.\.\.customer\b/,
    reason: "spreads every column from a customer object into a response, including passwordHash",
    fix: "Return an explicitly constructed safe object instead of spreading the full customer record.",
  },
];

// passwordHash is handled separately from the simple line-regex patterns
// above, deliberately. Unlike `user: true` (which is essentially always
// risky wherever it appears in app/api), the bare field name has several
// entirely legitimate internal uses that never reach a response — login
// reading it to verify a password, signup/user-creation hashing and
// inserting it, and this codebase's own existing toSafeUser() helper
// referencing it purely to destructure-and-discard. A plain substring
// check flags all of these as false positives, which would violate this
// guard's own "must not fail on existing safe code" requirement. The
// actual risk is specifically passwordHash reaching a NextResponse.json
// response — so this checks whether the field appears within the
// argument span of a NextResponse.json(...) call, tracked by paren
// depth, rather than anywhere in the file.
function findPasswordHashInResponses(strippedLines: string[]): number[] {
  const flaggedLineIndexes: number[] = [];
  let depth = 0;
  let inResponseCall = false;

  for (let i = 0; i < strippedLines.length; i++) {
    const line = strippedLines[i];
    let j = 0;
    while (j < line.length) {
      if (!inResponseCall && line.slice(j).startsWith("NextResponse.json(")) {
        inResponseCall = true;
        depth = 1;
        j += "NextResponse.json(".length;
        continue;
      }
      if (inResponseCall) {
        if (line[j] === "(") depth++;
        else if (line[j] === ")") {
          depth--;
          if (depth === 0) inResponseCall = false;
        }
      }
      j++;
    }
    if ((inResponseCall || line.includes("NextResponse.json(")) && /\bpasswordHash\b/.test(line)) {
      flaggedLineIndexes.push(i);
    }
  }
  return flaggedLineIndexes;
}

function stripComments(content: string): string[] {
  const lines = content.split("\n");
  return lines.map((line) => {
    if (line.trim().startsWith("//")) return ""; // whole-line comment
    const idx = line.indexOf("//");
    return idx === -1 ? line : line.slice(0, idx); // strip a trailing inline comment
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) out.push(full);
  }
  return out;
}

type Finding = { file: string; line: number; pattern: Pattern; snippet: string };

export function scan(root: string = SCAN_ROOT): Finding[] {
  const findings: Finding[] = [];
  if (!fs.existsSync(root)) return findings;

  const passwordHashPattern: Pattern = {
    label: "passwordHash",
    regex: /passwordHash/,
    reason: "passwordHash appears within the arguments of a NextResponse.json(...) call",
    fix: "Never include passwordHash in a response — omit it or select explicit safe columns before building the response.",
  };

  for (const file of walk(root)) {
    const rawLines = fs.readFileSync(file, "utf8").split("\n");
    const strippedLines = stripComments(rawLines.join("\n"));

    for (let i = 0; i < strippedLines.length; i++) {
      // An explicit, rare escape hatch — checked against the RAW line
      // (and the line before it) so a genuinely justified exception can
      // be documented right next to the code it applies to, without a
      // separate allowlist file to keep in sync.
      const allowedHere =
        rawLines[i].includes(ALLOW_COMMENT) || (i > 0 && rawLines[i - 1].includes(ALLOW_COMMENT));
      if (allowedHere) continue;

      for (const pattern of PATTERNS) {
        if (!pattern.regex.test(strippedLines[i])) continue;
        if (pattern.allowIf && pattern.allowIf(rawLines[i])) continue;
        findings.push({
          file: path.relative(process.cwd(), file),
          line: i + 1,
          pattern,
          snippet: rawLines[i].trim(),
        });
      }
    }

    const passwordHashLines = new Set(findPasswordHashInResponses(strippedLines));
    for (const i of passwordHashLines) {
      const allowedHere =
        rawLines[i].includes(ALLOW_COMMENT) || (i > 0 && rawLines[i - 1].includes(ALLOW_COMMENT));
      if (allowedHere) continue;
      findings.push({
        file: path.relative(process.cwd(), file),
        line: i + 1,
        pattern: passwordHashPattern,
        snippet: rawLines[i].trim(),
      });
    }
  }
  return findings;
}

function main() {
  const findings = scan();
  if (findings.length === 0) {
    console.log(`✔ Sensitive field exposure check passed — scanned app/api/** for ${PATTERNS.length} risky patterns, found none.`);
    process.exit(0);
  }

  console.error(`✘ Sensitive field exposure check failed — ${findings.length} issue(s) found:\n`);
  for (const f of findings) {
    console.error(
      `Unsafe API pattern detected: ${f.file}:${f.line} contains '${f.pattern.label}'.\n` +
        `  Why it's risky: ${f.pattern.reason}.\n` +
        `  Line: ${f.snippet}\n` +
        `  Suggested fix: ${f.pattern.fix}\n` +
        `  (If this is a genuine, justified exception, add a comment containing ${ALLOW_COMMENT}` +
        ` on this line or the line above, with a clear reason.)\n`
    );
  }
  process.exit(1);
}

// Only run as a CLI entry point — importable for tests without executing.
if (require.main === module) {
  main();
}
