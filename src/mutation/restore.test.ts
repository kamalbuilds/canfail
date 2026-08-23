import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileGuard } from "./restore.js";

const dirs: string[] = [];
function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "canfail-"));
  dirs.push(dir);
  const file = join(dir, "source.ts");
  writeFileSync(file, content, "utf8");
  return file;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FileGuard", () => {
  it("restores the original bytes after a write", () => {
    const file = tempFile("const a = 1;\n");
    const guard = new FileGuard();
    guard.write(file, "const a = 2;\n");
    expect(readFileSync(file, "utf8")).toBe("const a = 2;\n");
    guard.restore(file);
    expect(readFileSync(file, "utf8")).toBe("const a = 1;\n");
  });

  // The probe replaced snapshot()'s return value with a sentinel and every test
  // stayed green: nothing asserted on what it hands back.
  it("returns the original content from snapshot()", () => {
    const file = tempFile("const a = 1;\n");
    const guard = new FileGuard();
    expect(guard.snapshot(file)).toBe("const a = 1;\n");
  });

  it("keeps returning the first snapshot after the file changed on disk", () => {
    const file = tempFile("original\n");
    const guard = new FileGuard();
    guard.snapshot(file);
    writeFileSync(file, "changed\n", "utf8");
    expect(guard.snapshot(file)).toBe("original\n");
  });

  it("reports a dirty tree when a guarded file was changed behind its back", () => {
    const file = tempFile("const a = 1;\n");
    const guard = new FileGuard();
    guard.write(file, "const a = 2;\n");
    expect(guard.verifyClean()).toBe(false);
    guard.restoreAll();
    expect(guard.verifyClean()).toBe(true);
  });

  it("restores every guarded file, not just the last one", () => {
    const a = tempFile("A\n");
    const b = tempFile("B\n");
    const guard = new FileGuard();
    guard.write(a, "mutated\n");
    guard.write(b, "mutated\n");
    guard.restoreAll();
    expect(readFileSync(a, "utf8")).toBe("A\n");
    expect(readFileSync(b, "utf8")).toBe("B\n");
  });

  it("keeps the first snapshot when a file is written twice", () => {
    const file = tempFile("original\n");
    const guard = new FileGuard();
    guard.write(file, "first\n");
    guard.write(file, "second\n");
    guard.restore(file);
    expect(readFileSync(file, "utf8")).toBe("original\n");
  });
});
