/**
 * Self-verification. Requirement 7.1 - 7.3.
 *
 * A tool that reports "0 problems" is indistinguishable from a broken tool unless
 * it is run against code with known planted defects. This command is canfail's own
 * check-that-can-fail: it fails when a planted defect is missed AND when a defect
 * that was never planted is reported.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { scan } from "./orchestrator.js";
import type { DetectorKind } from "./types.js";

export interface PlantedDefect {
  file: string;
  line: number;
  kind: DetectorKind;
  subtype?: string;
  note: string;
}

export interface Manifest {
  description: string;
  planted: PlantedDefect[];
}

export interface VerifyResult {
  ok: boolean;
  matched: PlantedDefect[];
  missed: PlantedDefect[];
  unexpected: { file: string; line: number; kind: string; message: string }[];
}

export function verifyFixtures(fixtureRoot: string, opts: { mutate: boolean; testCommand?: string }): VerifyResult {
  const manifestPath = join(fixtureRoot, "canfail-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no canfail-manifest.json in ${fixtureRoot}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  const { report } = scan({
    root: fixtureRoot,
    mutate: opts.mutate,
    testCommand: opts.testCommand,
    timeoutMs: 30_000,
    maxMutantsPerTest: 12,
  });

  const actual = report.findings
    .filter((f) => !f.suppressed)
    .map((f) => ({
      file: relative(fixtureRoot, f.location.file),
      line: f.location.line,
      kind: f.kind as string,
      subtype: f.subtype,
      message: f.message,
    }));

  const matched: PlantedDefect[] = [];
  const missed: PlantedDefect[] = [];
  const consumed = new Set<number>();

  for (const p of manifest.planted) {
    if (!opts.mutate && p.kind === "SURVIVED") continue; // probe disabled: not this run's job
    const idx = actual.findIndex(
      (a, i) =>
        !consumed.has(i) &&
        a.file === p.file &&
        a.kind === p.kind &&
        Math.abs(a.line - p.line) <= 2 &&
        (!p.subtype || a.subtype === p.subtype),
    );
    if (idx >= 0) {
      consumed.add(idx);
      matched.push(p);
    } else {
      missed.push(p);
    }
  }

  const unexpected = actual.filter((_, i) => !consumed.has(i));
  return { ok: missed.length === 0 && unexpected.length === 0, matched, missed, unexpected };
}
