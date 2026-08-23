/**
 * End-to-end tests: run the built CLI as a subprocess, exactly as CI and a judge
 * would. Static detectors only, so these stay fast; the mutation probe is covered
 * by `verify-fixtures` in CI.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "bin", "canfail.js");

function canfail(args: string[]) {
  const res = spawnSync("node", [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("canfail CLI", () => {
  it("has been built before these tests run", () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it("exits 1 and names each finding on a project with vacuous checks", () => {
    const { code, stdout } = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "-q"]);
    expect(code).toBe(1);
    expect(stdout).toContain("VACUOUS");
    expect(stdout).toContain("MOCK");
    expect(stdout).toContain("SILENT");
    expect(stdout).toContain("checks that cannot fail");
  });

  it("exits 0 on a project whose tests genuinely constrain behaviour", () => {
    const { code, stdout } = canfail(["scan", "fixtures/clean-app", "--no-mutate", "-q"]);
    expect(code).toBe(0);
    expect(stdout).toContain("no vacuous checks found");
  });

  it("emits a valid CanfailReport under --json and nothing else on stdout", () => {
    const { code, stdout } = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--json"]);
    expect(code).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(report.summary.total).toBe(report.findings.filter((f: { suppressed: boolean }) => !f.suppressed).length);
    for (const f of report.findings) {
      expect(f).toMatchObject({
        id: expect.any(String),
        kind: expect.stringMatching(/^(VACUOUS|SURVIVED|MOCK|SILENT)$/),
        message: expect.any(String),
        suppressed: expect.any(Boolean),
      });
      expect(f.location.line).toBeGreaterThan(0);
    }
  });

  it("produces byte-identical JSON across two runs of unchanged code", () => {
    const strip = (s: string) => s.replace(/"timestamp": "[^"]+"/, "");
    const a = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--json"]).stdout;
    const b = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--json"]).stdout;
    expect(strip(a)).toBe(strip(b));
  });

  it("restricts output to the requested detector with --only", () => {
    const { stdout } = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--only", "MOCK", "-q"]);
    expect(stdout).toContain("MOCK");
    expect(stdout).not.toContain("VACUOUS");
    expect(stdout).not.toContain("SILENT");
  });

  it("passes the gate when --max-findings is raised above the finding count", () => {
    const below = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--max-findings", "2", "-q"]);
    const above = canfail(["scan", "fixtures/greenwashed-app", "--no-mutate", "--max-findings", "99", "-q"]);
    expect(below.code).toBe(1);
    expect(above.code).toBe(0);
  });

  it("skips excluded paths", () => {
    const { code, stdout } = canfail(["scan", ".", "--no-mutate", "--exclude", "fixtures", "-q"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain("greenwashed");
  });

  it("exits 2 with a message when the path does not exist", () => {
    const { code, stderr } = canfail(["scan", "fixtures/does-not-exist", "--no-mutate", "-q"]);
    expect(code).toBe(2);
    expect(stderr).toContain("path not found");
  });

  it("exits 2 on an unknown detector name rather than silently scanning everything", () => {
    const { code, stderr } = canfail(["scan", "fixtures/clean-app", "--only", "NONSENSE", "-q"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown detector");
  });

  it("verify-fixtures exits 0 and reports every planted defect matched", () => {
    const { code, stdout } = canfail(["verify-fixtures", "fixtures/greenwashed-app", "--no-mutate"]);
    expect(code).toBe(0);
    expect(stdout).toContain("caught every planted defect");
    expect(stdout).not.toContain("MISS");
  });

  it("verify-fixtures exits 2 when the manifest is missing", () => {
    const { code, stderr } = canfail(["verify-fixtures", "fixtures/clean-app", "--no-mutate"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no canfail-manifest.json");
  });
});
