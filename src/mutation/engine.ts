/**
 * SURVIVED detector — the probe that separates a real check from a green light.
 * Requirements 3.1 - 3.7.
 *
 * For each test file: break something the test imports, re-run only that test file,
 * and see whether the suite notices. Still green means the check cannot fail.
 */
import { relative } from "node:path";
import { readFileSync } from "node:fs";
import { buildImportGraph, reachableFrom } from "../graph/importer.js";
import { isTestFile } from "../ast/index.js";
import type { Finding, MutantDescriptor } from "../types.js";
import { findingId } from "../types.js";
import { applyMutation, collectMutationTargets, type MutationTarget } from "./mutants.js";
import { FileGuard, guardProcess } from "./restore.js";
import { runTestFile, type RunnerOptions } from "./runner.js";

export interface ProbeOptions extends RunnerOptions {
  root: string;
  files: string[];
  /** Hard cap on mutants per test file, keeps CI time bounded. Requirement 3.7. */
  maxMutantsPerTest: number;
  onProgress?: (msg: string) => void;
}

export interface ProbeStats {
  testFilesProbed: number;
  mutantsRun: number;
  killed: number;
  survived: number;
  timedOut: number;
  skippedBecauseSuiteRed: string[];
}

export interface ProbeResult {
  findings: Finding[];
  stats: ProbeStats;
}

function descriptorOf(t: MutationTarget, root: string): MutantDescriptor {
  return {
    mutation: t.kind,
    originalText: t.originalText,
    mutatedText: t.mutatedText,
    sourceFile: relative(root, t.file),
    sourceLine: t.line,
  };
}

export function probe(opts: ProbeOptions): ProbeResult {
  const { root, files, maxMutantsPerTest } = opts;
  const testFiles = files.filter((f) => isTestFile(f));
  const graph = buildImportGraph(root, files);
  const guard = new FileGuard();
  const dispose = guardProcess(guard);

  const findings: Finding[] = [];
  const stats: ProbeStats = {
    testFilesProbed: 0,
    mutantsRun: 0,
    killed: 0,
    survived: 0,
    timedOut: 0,
    skippedBecauseSuiteRed: [],
  };
  const seen = new Set<string>();

  try {
    for (const testFile of testFiles) {
      const rel = relative(root, testFile);

      // Baseline. A suite that is already red proves nothing about mutants.
      const baseline = runTestFile(testFile, opts);
      if (baseline.outcome !== "green") {
        stats.skippedBecauseSuiteRed.push(rel);
        opts.onProgress?.(`skip ${rel}: baseline is ${baseline.outcome}, nothing to probe`);
        continue;
      }
      stats.testFilesProbed += 1;

      // Only mutate first-party sources this test actually pulls in.
      const imported = [...reachableFrom(graph, testFile)].filter((f) => !isTestFile(f));
      const targets: MutationTarget[] = [];
      for (const src of imported) {
        targets.push(...collectMutationTargets(src));
        if (targets.length >= maxMutantsPerTest * 4) break;
      }

      // Spread the budget across distinct source lines rather than hammering one function.
      const byLine = new Map<string, MutationTarget>();
      for (const t of targets) {
        const key = `${t.file}:${t.line}`;
        if (!byLine.has(key)) byLine.set(key, t);
      }
      const budget = [...byLine.values()].slice(0, maxMutantsPerTest);

      opts.onProgress?.(`probe ${rel}: ${budget.length} mutants across ${imported.length} source files`);

      for (const target of budget) {
        const dedupeKey = `${target.file}:${target.line}:${target.kind}`;
        if (seen.has(dedupeKey)) continue;

        const original = guard.snapshot(target.file);
        const mutatedText = applyMutation(original, target);
        if (mutatedText === original) continue;

        guard.write(target.file, mutatedText);
        let result;
        try {
          result = runTestFile(testFile, opts);
        } finally {
          guard.restore(target.file); // Requirement 3.5: unconditional restore.
        }
        stats.mutantsRun += 1;

        if (result.outcome === "timeout") {
          stats.timedOut += 1;
          continue; // Requirement 3.6: a hung test is evidence the mutation had an effect.
        }
        if (result.outcome === "error") continue;

        if (result.outcome === "green") {
          stats.survived += 1;
          seen.add(dedupeKey);
          const text = readFileSync(target.file, "utf8");
          const lineText = text.split(/\r?\n/)[target.line - 1] ?? "";
          findings.push({
            id: findingId("SURVIVED", target.file, target.line, target.kind),
            kind: "SURVIVED",
            subtype: undefined,
            location: { file: target.file, line: target.line, column: target.column },
            message:
              `\`${target.originalText}\` → \`${target.mutatedText}\` and ${rel} stayed green: ` +
              `nothing in the suite depends on this being correct`,
            mutant: descriptorOf(target, root),
            suppressed: /canfail-ignore/.test(lineText),
          });
        } else {
          stats.killed += 1;
        }
      }
    }
  } finally {
    guard.restoreAll();
    if (!guard.verifyClean()) {
      // Requirement 3.5 is a hard invariant: refuse to exit quietly on a dirty tree.
      dispose();
      throw new Error("canfail could not restore a mutated source file; inspect your working tree before continuing");
    }
    dispose();
  }

  return { findings, stats };
}
