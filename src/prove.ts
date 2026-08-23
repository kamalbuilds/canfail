/**
 * UNEARNED detector — a new test that passes against the code it was written for.
 *
 * CI everywhere enforces that tests pass on the branch. Nothing enforces that a
 * new test would have FAILED on the base commit. A test written after the fact,
 * or generated alongside the code it is supposed to constrain, passes both before
 * and after the change: it documents the implementation instead of pinning the
 * behaviour, and it would not have caught the bug it claims to cover.
 *
 * canfail prove reverts the changed source files to their base revision, runs the
 * changed test files against that old code, and requires them to go red.
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildImportGraph, listSourceFiles, reachableFrom } from "./graph/importer.js";
import { detectLanguage, hasInlineTests, isTestFileAnyLanguage, scopeStrategy } from "./lang.js";
import { runTestFile, type RunnerOptions } from "./mutation/runner.js";
import type { Finding } from "./types.js";
import { findingId } from "./types.js";

const HIDDEN_SUFFIX = ".canfail-hidden";

function git(root: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function isGitRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

export function resolveRef(root: string, ref: string): string | undefined {
  const res = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return res.ok ? res.stdout.trim() : undefined;
}

/** Files that differ between `base` and the current working tree. */
export function changedFiles(root: string, base: string): string[] {
  const tracked = git(root, ["diff", "--name-only", base, "--"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  const names = [...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(names)].map((n) => resolve(root, n)).filter((f) => existsSync(f));
}

/** Content of a file at a revision, or undefined when it did not exist there. */
export function fileAtRef(root: string, ref: string, absPath: string): string | undefined {
  const rel = relative(root, absPath);
  const res = git(root, ["show", `${ref}:${rel}`]);
  return res.ok ? res.stdout : undefined;
}

/**
 * Reverts files to a base revision and puts everything back afterwards.
 * Files that did not exist at base are moved aside rather than deleted, so a
 * crash mid-run never destroys new work.
 */
class RevertGuard {
  private readonly restored = new Map<string, string>();
  private readonly hidden: string[] = [];

  revertTo(file: string, baseContent: string | undefined): void {
    if (baseContent === undefined) {
      const hiddenPath = file + HIDDEN_SUFFIX;
      renameSync(file, hiddenPath);
      this.hidden.push(file);
      return;
    }
    this.restored.set(file, readFileSync(file, "utf8"));
    writeFileSync(file, baseContent, "utf8");
  }

  restoreAll(): void {
    for (const [file, content] of this.restored) writeFileSync(file, content, "utf8");
    for (const file of this.hidden) {
      const hiddenPath = file + HIDDEN_SUFFIX;
      if (existsSync(hiddenPath)) renameSync(hiddenPath, file);
    }
    this.restored.clear();
    this.hidden.length = 0;
  }

  /** Every touched file is back exactly as it was, and no stray hidden file remains. */
  verifyClean(): boolean {
    for (const file of this.hidden) if (existsSync(file + HIDDEN_SUFFIX)) return false;
    return true;
  }
}

export interface ProveOptions extends Omit<RunnerOptions, "cwd"> {
  root: string;
  base: string;
  onProgress?: (msg: string) => void;
}

export interface ProveOutcome {
  findings: Finding[];
  /** Test files that correctly failed against the base revision. */
  earned: string[];
  /** Changed test files with no changed source in their import closure. */
  skipped: { file: string; reason: string }[];
  base: string;
}

export function prove(opts: ProveOptions): ProveOutcome {
  const { root, base } = opts;
  if (!isGitRepo(root)) throw new Error(`${root} is not a git repository; canfail prove needs history`);
  const baseSha = resolveRef(root, base);
  if (!baseSha) throw new Error(`cannot resolve base revision "${base}"`);

  const changed = changedFiles(root, base);
  const changedTests = changed.filter(isTestFileAnyLanguage);
  const changedSources = changed.filter((f) => !isTestFileAnyLanguage(f));

  const findings: Finding[] = [];
  const earned: string[] = [];
  const skipped: { file: string; reason: string }[] = [];

  if (changedTests.length === 0) {
    return { findings, earned, skipped, base: baseSha };
  }

  // The import graph is only built when a TypeScript or JavaScript test needs it.
  let graph: ReturnType<typeof buildImportGraph> | undefined;
  const guard = new RevertGuard();

  try {
    for (const testFile of changedTests) {
      const rel = relative(root, testFile);
      const lang = detectLanguage(testFile);

      let toRevert: string[];
      if (scopeStrategy(testFile) === "import-closure") {
        graph ??= buildImportGraph(root, listSourceFiles(root));
        const closure = reachableFrom(graph, testFile);
        toRevert = changedSources.filter((s) => closure.has(s));
      } else {
        // No import resolution for this language: revert the whole changed surface
        // of the same language, which is the stricter reading of the invariant.
        toRevert = changedSources.filter((s) => detectLanguage(s) === lang && !hasInlineTests(s));
      }

      const inlineBlocked = changedSources.filter((s) => detectLanguage(s) === lang && hasInlineTests(s));

      if (toRevert.length === 0) {
        skipped.push({
          file: rel,
          reason:
            inlineBlocked.length > 0
              ? `changed ${lang} sources keep their tests inside the source file, so reverting would delete the test being checked`
              : scopeStrategy(testFile) === "import-closure"
                ? "no changed source in this test's import closure, so there is nothing for it to have proved"
                : `no changed ${lang} source alongside this test, so there is nothing for it to have proved`,
        });
        continue;
      }

      opts.onProgress?.(`prove ${rel}: reverting ${toRevert.length} source file(s) to ${base}`);

      let outcome;
      try {
        for (const src of toRevert) guard.revertTo(src, fileAtRef(root, baseSha, src));
        outcome = runTestFile(testFile, { ...opts, cwd: root });
      } finally {
        guard.restoreAll();
      }

      if (outcome.outcome === "green") {
        // The test passes against code that predates it. It cannot be what
        // caught the defect this change fixes.
        findings.push({
          id: findingId("UNEARNED", testFile, 1, base),
          kind: "UNEARNED",
          location: { file: testFile, line: 1, column: 1 },
          message:
            `passes against ${base} with ${toRevert
              .map((s) => relative(root, s))
              .join(", ")} reverted: this test would not have failed before the change`,
          suppressed: /canfail-ignore/.test(readFileSync(testFile, "utf8").split(/\r?\n/)[0] ?? ""),
        });
      } else if (outcome.outcome === "timeout") {
        skipped.push({ file: rel, reason: "test run timed out against the base revision" });
      } else {
        earned.push(rel);
      }
    }
  } finally {
    guard.restoreAll();
    if (!guard.verifyClean()) {
      throw new Error(
        `canfail could not restore a reverted file. Look for stray *${HIDDEN_SUFFIX} files before continuing`,
      );
    }
  }

  return { findings, earned, skipped, base: baseSha };
}

/** Remove any leftovers from an interrupted run. */
export function cleanHidden(root: string): string[] {
  const stray = listSourceFiles(root).filter((f) => f.endsWith(HIDDEN_SUFFIX));
  for (const f of stray) rmSync(f, { force: true });
  return stray;
}
