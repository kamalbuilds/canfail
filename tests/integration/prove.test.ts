/**
 * canfail prove, exercised against a real git repository built on the fly.
 * Uses `node --test` so the temp repo needs no installed dependencies.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prove } from "../../src/prove.js";

const repos: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

const BUGGY = `export function discountFor(total) {
  // Off by one at the boundary: a basket of exactly 100 gets no discount.
  return total > 100 ? 10 : 0;
}
`;
const FIXED = `export function discountFor(total) {
  return total >= 100 ? 10 : 0;
}
`;

/** A repo whose base commit contains the bug, with the fix uncommitted. */
function repoWithFix(): string {
  const dir = mkdtempSync(join(tmpdir(), "canfail-prove-"));
  repos.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "discount.js"), BUGGY);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base: discount with a boundary bug");
  writeFileSync(join(dir, "src", "discount.js"), FIXED);
  return dir;
}

const opts = { base: "HEAD", testCommand: "node --test", timeoutMs: 60_000 };

describe("canfail prove", () => {
  it("accepts a test that fails against the base revision", () => {
    const dir = repoWithFix();
    writeFileSync(
      join(dir, "src", "discount.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { discountFor } from "./discount.js";

test("gives the discount exactly at the threshold", () => {
  assert.strictEqual(discountFor(100), 10);
});
`,
    );
    const result = prove({ root: dir, ...opts });
    expect(result.findings).toHaveLength(0);
    expect(result.earned).toEqual(["src/discount.test.js"]);
  });

  it("flags a test that passes against the code it predates", () => {
    const dir = repoWithFix();
    writeFileSync(
      join(dir, "src", "discount.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { discountFor } from "./discount.js";

test("gives the discount on a large basket", () => {
  assert.strictEqual(discountFor(500), 10);
});
`,
    );
    const result = prove({ root: dir, ...opts });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("UNEARNED");
    expect(result.findings[0].message).toContain("would not have failed before the change");
    expect(result.earned).toHaveLength(0);
  });

  it("restores the working tree byte-for-byte after reverting", () => {
    const dir = repoWithFix();
    writeFileSync(
      join(dir, "src", "discount.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { discountFor } from "./discount.js";
test("boundary", () => { assert.strictEqual(discountFor(100), 10); });
`,
    );
    const before = readFileSync(join(dir, "src", "discount.js"), "utf8");
    prove({ root: dir, ...opts });
    expect(readFileSync(join(dir, "src", "discount.js"), "utf8")).toBe(before);
    expect(before).toBe(FIXED);
    expect(readdirSync(join(dir, "src")).filter((f) => f.includes("canfail-hidden"))).toHaveLength(0);
  });

  it("restores a brand-new source file that did not exist at the base revision", () => {
    const dir = repoWithFix();
    writeFileSync(join(dir, "src", "vat.js"), `export const vat = (n) => n * 0.2;\n`);
    writeFileSync(
      join(dir, "src", "vat.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { vat } from "./vat.js";
test("vat", () => { assert.strictEqual(vat(100), 20); });
`,
    );
    const result = prove({ root: dir, ...opts });
    // The module did not exist at base, so the test cannot pass there.
    expect(result.findings).toHaveLength(0);
    expect(result.earned).toContain("src/vat.test.js");
    expect(readFileSync(join(dir, "src", "vat.js"), "utf8")).toBe(`export const vat = (n) => n * 0.2;\n`);
  });

  it("skips a changed test whose import closure contains no changed source", () => {
    const dir = repoWithFix();
    writeFileSync(join(dir, "src", "unrelated.js"), `export const two = () => 2;\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "add unrelated module");
    writeFileSync(
      join(dir, "src", "unrelated.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { two } from "./unrelated.js";
test("two", () => { assert.strictEqual(two(), 2); });
`,
    );
    const result = prove({ root: dir, base: "HEAD", testCommand: "node --test", timeoutMs: 60_000 });
    expect(result.findings).toHaveLength(0);
    expect(result.skipped.map((s) => s.file)).toContain("src/unrelated.test.js");
  });

  it("refuses to run outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "canfail-nogit-"));
    repos.push(dir);
    expect(() => prove({ root: dir, ...opts })).toThrow(/not a git repository/);
  });

  it("reports an unresolvable base revision instead of scanning nothing", () => {
    const dir = repoWithFix();
    expect(() => prove({ root: dir, ...opts, base: "no-such-ref" })).toThrow(/cannot resolve base revision/);
  });
});
