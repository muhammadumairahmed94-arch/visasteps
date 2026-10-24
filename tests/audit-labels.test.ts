import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { TEXT } from "../lib/activity";
import { STAGES } from "../lib/case-stage";
import type { reviewDocument } from "../lib/documents";
import type { changeUser } from "../lib/admin";

/**
 * Finds every audit action by scanning the code, so a new audit() or auditView() call
 * without a plain-English label in lib/activity.ts TEXT fails this test.
 */

const ROOT = path.resolve(__dirname, "..");
const SCAN = ["app", "lib", "scripts"];
const SKIP = new Set([path.join("lib", "audit.ts")]); // defines audit()/auditView() themselves

// Actions built from templates: every possible value. The `satisfies` checks make
// `npm run typecheck` fail if a value is added to (or removed from) the code without updating these.
const DOCUMENT_REVIEW = { approve: true, redo: true } satisfies Record<Parameters<typeof reviewDocument>[2], true>;
const USER_ACTIONS = { disable: true, enable: true, reset2fa: true, sendLink: true, role: true } satisfies Record<
  Parameters<typeof changeUser>[2]["action"],
  true
>;
const TEMPLATES: Record<string, string[]> = {
  "document.${}": Object.keys(DOCUMENT_REVIEW),
  "admin.user.${}": Object.keys(USER_ACTIONS),
  "staff.case.stageChange.${}": STAGES.map((s) => s.key),
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|mts)$/.test(name) ? [full] : [];
  });
}

/** The source text of the `action:` value inside a call starting at `start`, up to its top-level comma or brace. */
function actionExpr(src: string, start: number): string | null {
  const open = src.indexOf("(", start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === "(") depth++;
    else if (src[end] === ")" && --depth === 0) break;
  }
  const call = src.slice(open + 1, end);
  const m = /\baction\s*:/.exec(call);
  if (!m) return null;
  let i = m.index + m[0].length;
  let d = 0;
  let quote: string | null = null;
  const from = i;
  for (; i < call.length; i++) {
    const c = call[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) {
      if (d === 0) break;
      d--;
    } else if (c === "," && d === 0) break;
  }
  return call.slice(from, i).trim();
}

type Found = { action: string; where: string };

function scan(): { found: Found[]; problems: string[] } {
  const found: Found[] = [];
  const problems: string[] = [];
  for (const top of SCAN) {
    for (const file of files(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      if (SKIP.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?<![\w.])(audit|auditView)\(/g)) {
        if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
        const where = `${rel}:${src.slice(0, m.index).split("\n").length}`;
        const expr = actionExpr(src, m.index);
        if (expr === null) {
          problems.push(`${where}: ${m[1]}() call without an action`);
          continue;
        }
        // Strings in comparisons (`kind === "SETUP" ? …`) are conditions, not actions
        const literals = [...expr.replace(/[!=]==?\s*("[^"]*"|'[^']*')|("[^"]*"|'[^']*')\s*[!=]==?/g, "").matchAll(/"([^"]*)"|'([^']*)'/g)].map(
          (x) => x[1] ?? x[2],
        );
        const templates = [...expr.matchAll(/`([^`]*)`/g)].map((x) => x[1].replace(/\$\{[^}]*\}/g, "${}"));
        if (!literals.length && !templates.length) problems.push(`${where}: action is not a string or template the test can read: ${expr}`);
        for (const a of literals) found.push({ action: a, where });
        for (const t of templates) {
          const values = TEMPLATES[t];
          if (!values) problems.push(`${where}: new template \`${t}\` — add its values to TEMPLATES in tests/audit-labels.test.ts`);
          else for (const v of values) found.push({ action: t.replace("${}", v), where });
        }
      }
    }
  }
  return { found, problems };
}

const { found, problems } = scan();

describe("audit labels", () => {
  it("finds the audit calls in the code", () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it("can read the action of every audit() and auditView() call", () => {
    expect(problems, problems.join("\n")).toHaveLength(0);
  });

  it("every audit action in the code has a label in TEXT", () => {
    const missing = [...new Set(found.filter((f) => !(f.action in TEXT)).map((f) => `${f.action} (${f.where})`))];
    expect(missing, `Missing labels in lib/activity.ts:\n${missing.join("\n")}`).toHaveLength(0);
  });

  it("every label in TEXT belongs to an action the code can write", () => {
    const used = new Set(found.map((f) => f.action));
    const unused = Object.keys(TEXT).filter((k) => !used.has(k));
    expect(unused, `Labels for actions no code writes:\n${unused.join("\n")}`).toHaveLength(0);
  });

  it("TEXT contains no duplicate values for distinct actions", () => {
    const values = Object.values(TEXT);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes, `Duplicate label text: ${dupes.join(", ")}`).toHaveLength(0);
  });
});
