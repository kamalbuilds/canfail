/**
 * canfail prove against a real Go module.
 *
 * The UNEARNED invariant needs git, a test-file convention, and a command that
 * exits non-zero. Nothing here is TypeScript. These tests are skipped when the Go
 * toolchain is absent rather than silently passing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prove } from "../../src/prove.js";
import { buildCommand } from "../../src/mutation/runner.js";
import { conventionalTestCommand, detectLanguage, isTestFileAnyLanguage } from "../../src/lang.js";

const hasGo = spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;
const repos: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

const BUGGY = `package shop

// DiscountFor is off by one: a basket of exactly 100 gets no discount.
func DiscountFor(total int) int {
	if total > 100 {
		return 10
	}
	return 0
}
`;
const FIXED = BUGGY.replace("total > 100", "total >= 100").replace(
	"// DiscountFor is off by one: a basket of exactly 100 gets no discount.\n",
	"",
);

function goRepoWithFix(): string {
  const dir = mkdtempSync(join(tmpdir(), "canfail-go-"));
  repos.push(dir);
  writeFileSync(join(dir, "go.mod"), "module example.com/shop\n\ngo 1.21\n");
  writeFileSync(join(dir, "discount.go"), BUGGY);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base: discount with a boundary bug");
  writeFileSync(join(dir, "discount.go"), FIXED);
  return dir;
}

const goOpts = { base: "HEAD", testCommand: "go test ./{dir}", timeoutMs: 120_000 };

describe("language detection", () => {
  it("recognises test files across languages", () => {
    expect(isTestFileAnyLanguage("pkg/discount_test.go")).toBe(true);
    expect(isTestFileAnyLanguage("pkg/discount.go")).toBe(false);
    expect(isTestFileAnyLanguage("tests/test_pricing.py")).toBe(true);
    expect(isTestFileAnyLanguage("app/pricing_test.py")).toBe(true);
    expect(isTestFileAnyLanguage("app/pricing.py")).toBe(false);
    expect(isTestFileAnyLanguage("tests/integration.rs")).toBe(true);
    expect(isTestFileAnyLanguage("src/lib.rs")).toBe(false);
    expect(isTestFileAnyLanguage("spec/cart_spec.rb")).toBe(true);
    expect(isTestFileAnyLanguage("src/CartTest.java")).toBe(true);
    expect(isTestFileAnyLanguage("src/a.test.ts")).toBe(true);
    expect(isTestFileAnyLanguage("README.md")).toBe(false);
  });

  it("maps a file to its language", () => {
    expect(detectLanguage("x/y.go")).toBe("go");
    expect(detectLanguage("x/y.rs")).toBe("rust");
    expect(detectLanguage("x/y.tsx")).toBe("ts");
    expect(detectLanguage("x/y.md")).toBe("unknown");
  });

  it("places the path itself when the command uses a placeholder", () => {
    expect(buildCommand("/r/pkg/a_test.go", { cwd: "/r", testCommand: "go test ./{dir}" })).toBe(
      "go test ./pkg",
    );
    expect(buildCommand("/r/a_test.go", { cwd: "/r", testCommand: "go test ./{dir}" })).toBe("go test ./.");
    expect(buildCommand("/r/t/test_x.py", { cwd: "/r", testCommand: "python -m pytest {file}" })).toBe(
      "python -m pytest t/test_x.py",
    );
  });

  it("suggests the conventional runner per language", () => {
    expect(conventionalTestCommand("go")).toBe("go test ./{dir}");
    expect(conventionalTestCommand("unknown")).toBeUndefined();
  });
});

describe.skipIf(!hasGo)("canfail prove on a Go module", () => {
  it("accepts a Go test that fails against the base revision", () => {
    const dir = goRepoWithFix();
    writeFileSync(
      join(dir, "discount_test.go"),
      `package shop

import "testing"

func TestDiscountAtThreshold(t *testing.T) {
	if got := DiscountFor(100); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
}
`,
    );
    const result = prove({ root: dir, ...goOpts });
    expect(result.findings).toHaveLength(0);
    expect(result.earned).toEqual(["discount_test.go"]);
  });

  it("flags a Go test that passes against the code it predates", () => {
    const dir = goRepoWithFix();
    writeFileSync(
      join(dir, "discount_test.go"),
      `package shop

import "testing"

func TestDiscountOnLargeBasket(t *testing.T) {
	if got := DiscountFor(500); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
}
`,
    );
    const result = prove({ root: dir, ...goOpts });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("UNEARNED");
    expect(result.findings[0].message).toContain("discount.go");
    expect(result.earned).toHaveLength(0);
  });

  it("restores the Go source byte-for-byte after reverting", () => {
    const dir = goRepoWithFix();
    writeFileSync(
      join(dir, "discount_test.go"),
      `package shop

import "testing"

func TestDiscountAtThreshold(t *testing.T) {
	if got := DiscountFor(100); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
}
`,
    );
    prove({ root: dir, ...goOpts });
    expect(readFileSync(join(dir, "discount.go"), "utf8")).toBe(FIXED);
  });
});
