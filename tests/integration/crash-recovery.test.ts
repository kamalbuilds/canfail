/**
 * Crash recovery.
 *
 * This exists because it already happened: a screen-capture tool SIGKILLed
 * canfail mid-probe while this repo's README images were being generated, the
 * signal handlers never ran, and a mutated fixture reached a commit. These tests
 * kill a real probe with SIGKILL and require the next run to repair the tree.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverFromJournal, JOURNAL_FILE, Journal } from "../../src/mutation/journal.js";
import { FileGuard } from "../../src/mutation/restore.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "bin", "canfail.js");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `export function grade(score) {
  if (score >= 50) {
    return "pass";
  }
  return "fail";
}
`;

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "canfail-crash-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", type: "module", main: "src/grade.js" }));
  writeFileSync(join(dir, "src", "grade.js"), SOURCE);
  writeFileSync(
    join(dir, "src", "grade.test.js"),
    `import { test } from "node:test";
import assert from "node:assert";
import { grade } from "./grade.js";
test("passes a high score", () => { assert.strictEqual(grade(90), "pass"); });
`,
  );
  return dir;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("crash recovery", () => {
  it("repairs a file left mutated by a SIGKILLed probe", async () => {
    const dir = project();
    const source = join(dir, "src", "grade.js");

    const child = spawn(
      "node",
      [CLI, "scan", dir, "--test-command", "node --test", "--max-mutants", "12"],
      { stdio: "ignore" },
    );

    // Wait for the probe to actually mutate the file on disk.
    let mutated = false;
    for (let i = 0; i < 200 && !mutated; i++) {
      await sleep(50);
      if (existsSync(source) && readFileSync(source, "utf8") !== SOURCE) mutated = true;
    }
    child.kill("SIGKILL");
    await sleep(200);

    expect(mutated, "probe never mutated the file, so this test proves nothing").toBe(true);
    // Precondition: SIGKILL cannot be trapped, so the tree really is dirty here.
    expect(readFileSync(source, "utf8")).not.toBe(SOURCE);
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(true);

    const result = recoverFromJournal(dir);

    expect(result.failed).toEqual([]);
    expect(result.recovered).toContain(source);
    expect(readFileSync(source, "utf8")).toBe(SOURCE);
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
  }, 60_000);

  it("repairs the tree automatically at the start of the next scan", async () => {
    const dir = project();
    const source = join(dir, "src", "grade.js");

    const child = spawn("node", [CLI, "scan", dir, "--test-command", "node --test"], { stdio: "ignore" });
    let mutated = false;
    for (let i = 0; i < 200 && !mutated; i++) {
      await sleep(50);
      if (readFileSync(source, "utf8") !== SOURCE) mutated = true;
    }
    child.kill("SIGKILL");
    await sleep(200);
    expect(mutated).toBe(true);
    expect(readFileSync(source, "utf8")).not.toBe(SOURCE);

    // A plain static scan, with no probe, must still repair first.
    const res = spawn("node", [CLI, "scan", dir, "--no-mutate", "-q"], { stdio: "ignore" });
    await new Promise((r) => res.on("exit", r));

    expect(readFileSync(source, "utf8")).toBe(SOURCE);
  }, 60_000);

  it("leaves a clean tree untouched and writes no journal", () => {
    const dir = project();
    const before = readFileSync(join(dir, "src", "grade.js"), "utf8");
    const result = recoverFromJournal(dir);
    expect(result).toEqual({ recovered: [], failed: [] });
    expect(readFileSync(join(dir, "src", "grade.js"), "utf8")).toBe(before);
  });

  it("reports a file it cannot recover instead of claiming success", () => {
    const dir = project();
    const source = join(dir, "src", "grade.js");
    const journal = new Journal(dir, "2026-08-23T00:00:00.000Z");
    const guard = new FileGuard(journal);
    guard.write(source, "corrupted\n");
    // Simulate losing the backup, e.g. a wiped temp directory.
    rmSync(join(dir, ".canfail-backup"), { recursive: true, force: true });

    const result = recoverFromJournal(dir);
    expect(result.recovered).toEqual([]);
    expect(result.failed).toContain(source);
    // The journal survives so the problem stays visible.
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(true);
  });

  it("clears the journal and backups once a run finishes cleanly", () => {
    const dir = project();
    const source = join(dir, "src", "grade.js");
    const journal = new Journal(dir, "2026-08-23T00:00:00.000Z");
    const guard = new FileGuard(journal);
    guard.write(source, "mutated\n");
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(true);
    guard.restoreAll();
    guard.releaseJournal();
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
    expect(existsSync(join(dir, ".canfail-backup"))).toBe(false);
    expect(readFileSync(source, "utf8")).toBe(SOURCE);
  });
});
