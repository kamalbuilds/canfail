import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportGraph, findEntryPoints, importChain, listSourceFiles, reachableFrom } from "./importer.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "canfail-graph-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("import graph", () => {
  it("resolves a relative .js specifier to the .ts file on disk", () => {
    const root = project({
      "src/index.ts": `export { a } from "./a.js";`,
      "src/a.ts": `export const a = 1;`,
    });
    const graph = buildImportGraph(root);
    expect(graph.edges.get(join(root, "src/index.ts"))).toEqual([join(root, "src/a.ts")]);
  });

  it("walks a transitive chain and reports the shortest path", () => {
    const root = project({
      "src/index.ts": `export * from "./b.js";`,
      "src/b.ts": `export * from "./c.js";`,
      "src/c.ts": `export const c = 3;`,
    });
    const graph = buildImportGraph(root);
    const entry = join(root, "src/index.ts");
    expect(reachableFrom(graph, entry).has(join(root, "src/c.ts"))).toBe(true);
    expect(importChain(graph, entry, join(root, "src/c.ts"), root)).toEqual([
      "src/index.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("does not treat a bare package specifier as a first-party edge", () => {
    const root = project({ "src/index.ts": `import { z } from "zod";\nexport const a = 1;` });
    const graph = buildImportGraph(root);
    expect(graph.edges.get(join(root, "src/index.ts"))).toEqual([]);
  });

  it("ignores a type-only import, which does not exist at runtime", () => {
    const root = project({
      "src/index.ts": `import type { T } from "./t.js";\nexport const a: T = 1;`,
      "src/t.ts": `export type T = number;`,
    });
    const graph = buildImportGraph(root);
    expect(graph.edges.get(join(root, "src/index.ts"))).toEqual([]);
  });

  it("skips node_modules and build output when listing sources", () => {
    const root = project({
      "src/index.ts": `export const a = 1;`,
      "node_modules/pkg/index.ts": `export const b = 2;`,
      "dist/index.js": `export const c = 3;`,
    });
    expect(listSourceFiles(root)).toEqual([join(root, "src/index.ts")]);
  });

  it("throws on a malformed package.json instead of reporting no entry points", () => {
    // Silently returning [] here would disable the MOCK detector without telling
    // anyone: the scan would pass because nothing was reachable.
    const root = project({ "package.json": `{ "main": `, "src/index.ts": `export const a = 1;` });
    expect(() => findEntryPoints(root)).toThrow(/could not read entry points/);
  });

  it("finds the conventional entry point when package.json has none", () => {
    const root = project({ "package.json": `{"name":"x"}`, "src/index.ts": `export const a = 1;` });
    expect(findEntryPoints(root)).toContain(join(root, "src/index.ts"));
  });
});
