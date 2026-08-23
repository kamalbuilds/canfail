/**
 * Test-runner bridge. canfail deliberately knows nothing about the test framework:
 * pass/fail is the exit code of the configured command, nothing else.
 * Requirements 3.3, 3.6.
 */
import { spawnSync } from "node:child_process";
import { dirname, relative } from "node:path";

export type RunOutcome = "green" | "red" | "timeout" | "error";

export interface RunResult {
  outcome: RunOutcome;
  exitCode: number | null;
  durationMs: number;
  stderrTail?: string;
}

export interface RunnerOptions {
  cwd: string;
  /** e.g. `npx vitest run` — the test file path is appended. */
  testCommand: string;
  timeoutMs: number;
}

/**
 * Test runners treat the argument as a filename filter matched against paths
 * relative to the project root. An absolute path breaks that match whenever the
 * root is reached through a symlink (/tmp -> /private/tmp on macOS), which reads
 * back as "suite is red" and silently skips the probe. Always pass a relative path.
 */
export function buildCommand(testFile: string, opts: Pick<RunnerOptions, "cwd" | "testCommand">): string {
  const rel = relative(opts.cwd, testFile) || testFile;
  const dir = dirname(rel) || ".";

  // Not every runner takes a file. `go test` wants a package directory, so a
  // command may place the path itself with {file} or {dir}; only commands that
  // use neither get the path appended.
  if (/\{file\}|\{dir\}/.test(opts.testCommand)) {
    return opts.testCommand.replaceAll("{file}", rel).replaceAll("{dir}", dir);
  }
  return `${opts.testCommand} ${JSON.stringify(rel)}`;
}

export function runTestFile(testFile: string, opts: RunnerOptions): RunResult {
  const started = Date.now();
  const command = buildCommand(testFile, opts);
  const res = spawnSync(command, {
    cwd: opts.cwd,
    shell: true,
    timeout: opts.timeoutMs,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", CANFAIL_PROBE: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });

  const durationMs = Date.now() - started;
  const stderrTail = (res.stderr ?? "").split("\n").slice(-6).join("\n").trim() || undefined;

  if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { outcome: "timeout", exitCode: null, durationMs, stderrTail };
  }
  if (res.signal === "SIGTERM" && durationMs >= opts.timeoutMs - 50) {
    return { outcome: "timeout", exitCode: null, durationMs, stderrTail };
  }
  if (res.error) {
    return { outcome: "error", exitCode: null, durationMs, stderrTail: String(res.error) };
  }
  return { outcome: res.status === 0 ? "green" : "red", exitCode: res.status, durationMs, stderrTail };
}

/** Guess a test command from the target project's package.json scripts. */
export function inferTestCommand(pkg: Record<string, unknown> | undefined): string {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const test = scripts.test ?? "";
  if (/vitest/.test(test)) return "npx vitest run";
  if (/jest/.test(test)) return "npx jest --ci";
  if (/node --test|node:test/.test(test)) return "node --test";
  if (/mocha/.test(test)) return "npx mocha";
  return "npx vitest run";
}
