/**
 * Import graph over a project's TS/JS sources.
 * Used by MOCK (reachability from an entry point) and by the mutation engine
 * (which source files does this test file actually exercise).
 * Requirements 4.2, 3.1.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".kiro",
]);

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") {
        if (IGNORED_DIRS.has(e.name)) continue;
      }
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        walk(full);
      } else if (SOURCE_EXT.includes(extname(e.name)) && !e.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(resolve(root));
  return out.sort();
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import\s[\s\S]*?from\s*|import\s*|export\s[\s\S]*?from\s*)["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

/** Extract raw specifiers. Type-only imports are excluded: they vanish at runtime. */
export function readImportSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const full = m[0];
    if (/^\s*import\s+type\s/.test(full)) continue;
    const spec = m[1] ?? m[2];
    if (spec) out.push(spec);
  }
  return out;
}

/** Resolve a relative specifier to a real file on disk, trying the usual extension ladder. */
export function resolveSpecifier(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined; // bare package: not our code
  const base = resolve(dirname(fromFile), spec);
  const candidates: string[] = [];

  // `./x.js` in ESM TypeScript usually means `./x.ts` on disk.
  const ext = extname(base);
  if (ext) {
    candidates.push(base);
    const stem = base.slice(0, -ext.length);
    for (const e of SOURCE_EXT) candidates.push(stem + e);
  } else {
    for (const e of SOURCE_EXT) candidates.push(base + e);
    for (const e of SOURCE_EXT) candidates.push(join(base, "index" + e));
  }

  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

export interface ImportGraph {
  /** file -> files it imports (resolved, first-party only) */
  edges: Map<string, string[]>;
  files: string[];
}

export function buildImportGraph(root: string, files?: string[]): ImportGraph {
  const list = files ?? listSourceFiles(root);
  const edges = new Map<string, string[]>();
  for (const f of list) {
    const resolved: string[] = [];
    for (const spec of readImportSpecifiers(f)) {
      const target = resolveSpecifier(f, spec);
      if (target) resolved.push(target);
    }
    edges.set(f, resolved);
  }
  return { edges, files: list };
}

/** All files transitively reachable from `start`, excluding `start` itself unless cyclic. */
export function reachableFrom(graph: ImportGraph, start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(graph.edges.get(start) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of graph.edges.get(cur) ?? []) stack.push(next);
  }
  return seen;
}

/**
 * Shortest import chain from `start` to `target`, as relative paths.
 * This is what turns "there is a mock somewhere" into evidence a judge can follow.
 */
export function importChain(
  graph: ImportGraph,
  start: string,
  target: string,
  root: string,
): string[] | undefined {
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const tail = path[path.length - 1];
    if (tail === target) return path.map((p) => relative(root, p));
    for (const next of graph.edges.get(tail) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return undefined;
}

/**
 * Guess the production entry points of a project: package.json main/module/bin/exports,
 * then conventional locations. Test files are never entry points.
 */
export function findEntryPoints(root: string): string[] {
  const out = new Set<string>();
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      const candidates: string[] = [];
      for (const key of ["main", "module", "browser"]) {
        const v = pkg[key];
        if (typeof v === "string") candidates.push(v);
      }
      const bin = pkg.bin;
      if (typeof bin === "string") candidates.push(bin);
      else if (bin && typeof bin === "object") {
        for (const v of Object.values(bin as Record<string, string>)) candidates.push(v);
      }
      for (const c of candidates) {
        // dist/... paths point at build output; map them back to source.
        const mapped = c.replace(/^(\.\/)?dist\//, "").replace(/\.js$/, ".ts");
        for (const guess of [c, mapped, join("src", mapped)]) {
          const r = resolveSpecifier(join(root, "package.json"), "./" + guess.replace(/^\.\//, ""));
          if (r) out.add(r);
        }
      }
    } catch {
      /* malformed package.json is handled by the caller */
    }
  }
  for (const guess of [
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "src/main.tsx",
    "src/app.ts",
    "src/App.tsx",
    "src/server.ts",
    "index.ts",
    "index.js",
    "app.js",
    "server.js",
  ]) {
    const full = join(root, guess);
    if (existsSync(full)) out.add(full);
  }
  return [...out];
}
