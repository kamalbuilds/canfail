import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { buildCommand, inferTestCommand, runTestFile } from "./runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildCommand", () => {
  // Regression: canfail passed an absolute path as the test filter. Under a
  // symlinked root the filter matched nothing, the runner exited 1, and every
  // probe was silently skipped as "baseline red". The bug was invisible because
  // skipping looks exactly like a healthy run with fewer findings.
  it("passes the test file relative to the project root, never absolute", () => {
    const cmd = buildCommand("/private/tmp/proj/src/a.test.ts", {
      cwd: "/private/tmp/proj",
      testCommand: "npx vitest run",
    });
    expect(cmd).toBe('npx vitest run "src/a.test.ts"');
    expect(isAbsolute(JSON.parse(cmd.split(" ").pop()!))).toBe(false);
  });

  it("quotes a path containing spaces", () => {
    const cmd = buildCommand("/proj/src/my test.test.ts", { cwd: "/proj", testCommand: "npx vitest run" });
    expect(cmd).toBe('npx vitest run "src/my test.test.ts"');
  });
});

describe("runTestFile", () => {
  it("reads a passing suite as green and a failing suite as red via exit code alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "canfail-runner-"));
    dirs.push(dir);
    writeFileSync(join(dir, "pass.js"), "process.exit(0)");
    writeFileSync(join(dir, "fail.js"), "process.exit(1)");

    const green = runTestFile(join(dir, "pass.js"), { cwd: dir, testCommand: "node", timeoutMs: 20_000 });
    const red = runTestFile(join(dir, "fail.js"), { cwd: dir, testCommand: "node", timeoutMs: 20_000 });

    expect(green.outcome).toBe("green");
    expect(green.exitCode).toBe(0);
    expect(red.outcome).toBe("red");
    expect(red.exitCode).toBe(1);
  });

  it("resolves the test file when the project root is reached through a symlink", () => {
    const real = mkdtempSync(join(tmpdir(), "canfail-real-"));
    dirs.push(real);
    mkdirSync(join(real, "src"));
    // Exits 0 only when argv[2] resolves to a readable file, which is what a
    // filename filter has to do.
    writeFileSync(
      join(real, "src", "check.js"),
      "const fs=require('fs');process.exit(fs.existsSync(process.argv[2])?0:1)",
    );
    const link = join(real, "..", `canfail-link-${process.pid}`);
    symlinkSync(real, link);
    dirs.push(link);

    const result = runTestFile(join(link, "src", "check.js"), {
      cwd: link,
      testCommand: `node ${JSON.stringify(join(link, "src", "check.js"))}`,
      timeoutMs: 20_000,
    });
    expect(result.outcome).toBe("green");
  });

  it("reports a timeout rather than treating a hung suite as green", () => {
    const dir = mkdtempSync(join(tmpdir(), "canfail-hang-"));
    dirs.push(dir);
    writeFileSync(join(dir, "hang.js"), "setTimeout(()=>{}, 60000)");
    const result = runTestFile(join(dir, "hang.js"), { cwd: dir, testCommand: "node", timeoutMs: 1200 });
    expect(result.outcome).toBe("timeout");
    expect(result.outcome).not.toBe("green");
  });
});

describe("inferTestCommand", () => {
  it("picks the runner named in the project's test script", () => {
    expect(inferTestCommand({ scripts: { test: "vitest run --coverage" } })).toBe("npx vitest run");
    expect(inferTestCommand({ scripts: { test: "jest --ci" } })).toBe("npx jest --ci");
    expect(inferTestCommand({ scripts: { test: "mocha spec/" } })).toBe("npx mocha");
    expect(inferTestCommand({ scripts: { test: "node --test" } })).toBe("node --test");
  });

  it("falls back to vitest when there is no test script", () => {
    expect(inferTestCommand(undefined)).toBe("npx vitest run");
  });
});
