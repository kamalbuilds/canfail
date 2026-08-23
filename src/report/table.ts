/**
 * Human table. Requirement 6.4: readable without a terminal that supports colour,
 * and every row carries a file:line a judge or a developer can jump to.
 */
import { relative } from "node:path";
import type { CanfailReport, DetectorKind, Finding } from "../types.js";

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (USE_COLOR ? `[${code}m${s}[0m` : s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const green = (s: string) => c("32", s);

const KIND_COLOR: Record<DetectorKind, (s: string) => string> = {
  VACUOUS: yellow,
  SURVIVED: red,
  MOCK: red,
  SILENT: yellow,
  UNEARNED: red,
};

const KIND_EXPLAIN: Record<DetectorKind, string> = {
  VACUOUS: "test cannot go red",
  SURVIVED: "code was broken, test stayed green",
  MOCK: "placeholder data reachable in production",
  SILENT: "failure reported as success",
  UNEARNED: "new test passes on the code it predates",
};

export function renderTable(report: CanfailReport, root: string): string {
  const lines: string[] = [];
  const visible = report.findings.filter((f) => !f.suppressed);

  if (visible.length === 0) {
    lines.push("");
    lines.push(green("  no vacuous checks found"));
    lines.push("");
    return lines.join("\n");
  }

  const byFile = new Map<string, Finding[]>();
  for (const f of visible) {
    const key = relative(root, f.location.file) || f.location.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(f);
  }

  lines.push("");
  for (const [file, findings] of [...byFile.entries()].sort()) {
    lines.push(bold(file));
    for (const f of findings.sort((a, b) => a.location.line - b.location.line)) {
      const kind = KIND_COLOR[f.kind](f.kind.padEnd(8));
      const loc = dim(`:${f.location.line}`.padEnd(6));
      lines.push(`  ${kind}${loc} ${f.message}`);
      if (f.chain && f.chain.length > 1) {
        lines.push(dim(`           reached via  ${f.chain.join("  ->  ")}`));
      }
      if (f.mutant) {
        lines.push(
          dim(`           mutation     ${f.mutant.mutation} at ${f.mutant.sourceFile}:${f.mutant.sourceLine}`),
        );
      }
    }
    lines.push("");
  }

  const s = report.summary;
  const parts: string[] = [];
  for (const kind of ["VACUOUS", "SURVIVED", "MOCK", "SILENT", "UNEARNED"] as DetectorKind[]) {
    if (s.byKind[kind] > 0) parts.push(`${s.byKind[kind]} ${kind} (${KIND_EXPLAIN[kind]})`);
  }
  lines.push(bold(`  ${s.total} checks that cannot fail`));
  for (const p of parts) lines.push(`    ${p}`);
  if (s.suppressed > 0) lines.push(dim(`    ${s.suppressed} suppressed via canfail-ignore`));
  lines.push("");
  return lines.join("\n");
}
