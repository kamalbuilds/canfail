/**
 * Sequences the four detectors and assembles the report.
 * Requirements 1.1 - 1.5, 6.1 - 6.3.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isTestFile } from "./ast/index.js";
import { detectMock } from "./detectors/mock.js";
import { detectSilent } from "./detectors/silent.js";
import { detectVacuous } from "./detectors/vacuous.js";
import { listSourceFiles } from "./graph/importer.js";
import { probe, type ProbeStats } from "./mutation/engine.js";
import { inferTestCommand } from "./mutation/runner.js";
import type { CanfailReport, DetectorKind, Finding } from "./types.js";
import { summarize } from "./types.js";

export const VERSION = "0.1.0";

export interface ScanOptions {
  root: string;
  mutate: boolean;
  testCommand?: string;
  timeoutMs: number;
  maxMutantsPerTest: number;
  only?: DetectorKind[];
  onProgress?: (msg: string) => void;
  /** Frozen timestamp, so fixture verification is byte-reproducible. */
  now?: string;
}

export interface ScanResult {
  report: CanfailReport;
  probeStats?: ProbeStats;
}

export function scan(opts: ScanOptions): ScanResult {
  const root = opts.root;
  if (!existsSync(root)) throw new Error(`path not found: ${root}`);

  const files = listSourceFiles(root);
  const wants = (k: DetectorKind) => !opts.only || opts.only.includes(k);
  const findings: Finding[] = [];

  if (wants("VACUOUS")) {
    for (const f of files.filter(isTestFile)) {
      try {
        findings.push(...detectVacuous(f));
      } catch (err) {
        opts.onProgress?.(`skip ${f}: ${(err as Error).message}`);
      }
    }
  }

  if (wants("SILENT")) {
    for (const f of files.filter((x) => !isTestFile(x))) {
      try {
        findings.push(...detectSilent(f));
      } catch (err) {
        opts.onProgress?.(`skip ${f}: ${(err as Error).message}`);
      }
    }
  }

  if (wants("MOCK")) {
    try {
      findings.push(...detectMock({ root, files }));
    } catch (err) {
      opts.onProgress?.(`MOCK detector skipped: ${(err as Error).message}`);
    }
  }

  let probeStats: ProbeStats | undefined;
  if (opts.mutate && wants("SURVIVED")) {
    const pkgPath = join(root, "package.json");
    const pkg = existsSync(pkgPath)
      ? (JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>)
      : undefined;
    const testCommand = opts.testCommand ?? inferTestCommand(pkg);
    const result = probe({
      root,
      files,
      cwd: root,
      testCommand,
      timeoutMs: opts.timeoutMs,
      maxMutantsPerTest: opts.maxMutantsPerTest,
      onProgress: opts.onProgress,
    });
    findings.push(...result.findings);
    probeStats = result.stats;
  }

  // Deterministic ordering so two runs diff cleanly.
  findings.sort(
    (a, b) =>
      a.location.file.localeCompare(b.location.file) ||
      a.location.line - b.location.line ||
      a.kind.localeCompare(b.kind),
  );

  const report: CanfailReport = {
    version: VERSION,
    timestamp: opts.now ?? new Date().toISOString(),
    summary: summarize(findings),
    findings,
  };
  return { report, probeStats };
}
