#!/usr/bin/env node
/**
 * canfail CLI. Requirements 1.1 - 1.4, 6.1 - 6.4, 7.1 - 7.4.
 *
 * Exit codes:
 *   0  gate passed
 *   1  gate failed (findings above threshold)
 *   2  canfail could not run (bad path, invalid options, unrestorable file)
 */
import { Command } from "commander";
import { relative, resolve } from "node:path";
import { renderTable } from "./../src/report/table.js";
import { scan, VERSION } from "./../src/orchestrator.js";
import type { DetectorKind } from "./../src/types.js";
import { verifyFixtures } from "./../src/verify-fixtures.js";
import { prove } from "./../src/prove.js";

const ALL_KINDS: DetectorKind[] = ["VACUOUS", "SURVIVED", "MOCK", "SILENT"];

const program = new Command();
program
  .name("canfail")
  .description("Prove your tests can actually fail. Finds checks that are green because they cannot go red.")
  .version(VERSION);

program
  .command("scan", { isDefault: true })
  .argument("[path]", "project root to scan", ".")
  .option("--json", "emit a machine-readable CanfailReport on stdout", false)
  .option("--no-mutate", "static detectors only; skip the mutation probe")
  .option("--test-command <cmd>", "command that runs one test file (inferred from package.json when omitted)")
  .option("--timeout <ms>", "per-test-run timeout for the mutation probe", "30000")
  .option("--max-mutants <n>", "mutants attempted per test file", "12")
  .option("--only <kinds>", `comma-separated subset of ${ALL_KINDS.join(",")}`)
  .option("--exclude <paths>", "comma-separated path substrings to skip, e.g. fixtures,vendor")
  .option("--max-findings <n>", "gate threshold: fail above this many findings", "0")
  .option("-q, --quiet", "suppress progress output on stderr", false)
  .action((path: string, options: Record<string, unknown>) => {
    const root = resolve(String(path));
    const only = options.only
      ? String(options.only)
          .split(",")
          .map((s) => s.trim().toUpperCase() as DetectorKind)
      : undefined;

    if (only?.some((k) => !ALL_KINDS.includes(k))) {
      process.stderr.write(`unknown detector in --only; valid values: ${ALL_KINDS.join(", ")}\n`);
      process.exit(2);
    }

    const asJson = Boolean(options.json);
    const quiet = Boolean(options.quiet) || asJson;

    try {
      const { report, probeStats } = scan({
        root,
        mutate: options.mutate !== false,
        testCommand: options.testCommand as string | undefined,
        timeoutMs: Number(options.timeout),
        maxMutantsPerTest: Number(options.maxMutants),
        only,
        exclude: options.exclude
          ? String(options.exclude)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        onProgress: quiet ? undefined : (m) => process.stderr.write(`  ${m}\n`),
      });

      if (asJson) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(renderTable(report, root));
        if (probeStats) {
          process.stdout.write(
            `  probe: ${probeStats.mutantsRun} mutants across ${probeStats.testFilesProbed} test files, ` +
              `${probeStats.killed} killed, ${probeStats.survived} survived\n`,
          );
          for (const f of probeStats.skippedBecauseSuiteRed) {
            process.stdout.write(`  note: skipped ${f}, its suite was already failing\n`);
          }
          process.stdout.write("\n");
        }
      }

      const threshold = Number(options.maxFindings);
      process.exit(report.summary.total > threshold ? 1 : 0);
    } catch (err) {
      process.stderr.write(`canfail: ${(err as Error).message}\n`);
      process.exit(2);
    }
  });

program
  .command("prove")
  .description("require every changed test to fail against the base revision of the code it covers")
  .argument("[path]", "git repository root", ".")
  .option("--base <ref>", "revision the tests must fail against", "HEAD~1")
  .option("--test-command <cmd>", "command that runs one test file", "npx vitest run")
  .option("--timeout <ms>", "per-test-run timeout", "60000")
  .option("--json", "emit findings as JSON", false)
  .option("-q, --quiet", "suppress progress output on stderr", false)
  .action((path: string, options: Record<string, unknown>) => {
    const root = resolve(String(path));
    const quiet = Boolean(options.quiet) || Boolean(options.json);
    try {
      const result = prove({
        root,
        base: String(options.base),
        testCommand: String(options.testCommand),
        timeoutMs: Number(options.timeout),
        onProgress: quiet ? undefined : (m) => process.stderr.write(`  ${m}\n`),
      });

      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        const color = process.stdout.isTTY && !process.env.NO_COLOR;
        const green = (s: string) => (color ? `[32m${s}[0m` : s);
        const red = (s: string) => (color ? `[31m${s}[0m` : s);
        const dim = (s: string) => (color ? `[2m${s}[0m` : s);

        process.stdout.write("\n");
        for (const e of result.earned) {
          process.stdout.write(
            `  ${green("EARNED  ")} ${e}\n           ${dim(`failed against ${options.base}, as a new test should`)}\n`,
          );
        }
        for (const f of result.findings.filter((x) => !x.suppressed)) {
          process.stdout.write(
            `  ${red("UNEARNED")} ${relative(root, f.location.file)}\n           ${f.message}\n`,
          );
        }
        for (const s of result.skipped) {
          process.stdout.write(`  skipped  ${s.file}\n           ${s.reason}\n`);
        }
        const unearned = result.findings.filter((x) => !x.suppressed).length;
        process.stdout.write(
          unearned === 0
            ? `\n  ${result.earned.length} changed test(s), every one of them failed before the change\n\n`
            : `\n  ${unearned} test(s) that would not have caught the change they ship with\n\n`,
        );
      }

      process.exit(result.findings.filter((x) => !x.suppressed).length > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write(`canfail: ${(err as Error).message}\n`);
      process.exit(2);
    }
  });

program
  .command("verify-fixtures")
  .description("run canfail against a fixture repo with planted defects and assert every one is caught")
  .argument("[path]", "fixture root containing canfail-manifest.json", "fixtures/greenwashed-app")
  .option("--no-mutate", "skip SURVIVED entries in the manifest")
  .option("--test-command <cmd>", "command that runs one test file")
  .action((path: string, options: Record<string, unknown>) => {
    const root = resolve(String(path));
    try {
      const result = verifyFixtures(root, {
        mutate: options.mutate !== false,
        testCommand: options.testCommand as string | undefined,
      });

      process.stdout.write(`\n  planted defects matched: ${result.matched.length}\n`);
      for (const m of result.matched) {
        process.stdout.write(`    ok    ${m.kind.padEnd(8)} ${m.file}:${m.line}  ${m.note}\n`);
      }
      for (const m of result.missed) {
        process.stdout.write(`    MISS  ${m.kind.padEnd(8)} ${m.file}:${m.line}  ${m.note}\n`);
      }
      for (const u of result.unexpected) {
        process.stdout.write(`    EXTRA ${u.kind.padEnd(8)} ${u.file}:${u.line}  ${u.message}\n`);
      }
      process.stdout.write(
        result.ok
          ? `\n  canfail caught every planted defect and reported nothing else\n\n`
          : `\n  fixture verification FAILED: ${result.missed.length} missed, ${result.unexpected.length} unexpected\n\n`,
      );
      process.exit(result.ok ? 0 : 1);
    } catch (err) {
      process.stderr.write(`canfail: ${(err as Error).message}\n`);
      process.exit(2);
    }
  });

program.parse();
