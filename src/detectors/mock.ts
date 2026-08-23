/**
 * MOCK detector — placeholder data reachable from a production entry point.
 * Requirements 4.1 - 4.4.
 *
 * The point is reachability. A mock inside `__mocks__` or a `*.test.ts` is fine.
 * A mock that a user can reach by opening the app is a shipped lie, and that is
 * exactly how a hardcoded product record reaches an app-store review build.
 */
import { relative } from "node:path";
import { readFileSync } from "node:fs";
import { Node, isSuppressed, isTestFile, locationOf, parseSnippet } from "../ast/index.js";
import type { Finding, MockSubtype } from "../types.js";
import { findingId } from "../types.js";
import { buildImportGraph, findEntryPoints, importChain, reachableFrom } from "../graph/importer.js";

const MOCK_ID_RE = /^(MOCK|DEMO|FAKE|DUMMY|SAMPLE|STUB|PLACEHOLDER|TEST|SEED)_/;
const MOCK_CAMEL_RE = /^(mock|demo|fake|dummy|sample|stub|placeholder)[A-Z]\w*/;
const MOCK_PATH_RE = /(^|\/)(__mocks__|__fixtures__|mocks?|fixtures?|stubs?)(\/|$)/;

/** Identifiers whose name announces they are not real data. */
function isMockName(name: string): boolean {
  return MOCK_ID_RE.test(name) || MOCK_CAMEL_RE.test(name);
}

export interface MockOptions {
  root: string;
  files: string[];
  entryPoints?: string[];
}

export function detectMock(opts: MockOptions): Finding[] {
  const { root } = opts;
  const productionFiles = opts.files.filter((f) => !isTestFile(f));
  const graph = buildImportGraph(root, opts.files);
  const entries = (opts.entryPoints?.length ? opts.entryPoints : findEntryPoints(root)).filter((e) =>
    opts.files.includes(e),
  );

  // Reachable set = every file an entry point can pull in at runtime.
  const reachable = new Set<string>();
  for (const e of entries) {
    reachable.add(e);
    for (const f of reachableFrom(graph, e)) reachable.add(f);
  }

  const findings: Finding[] = [];

  for (const file of productionFiles) {
    if (entries.length > 0 && !reachable.has(file)) continue; // unreachable: not shipped
    if (MOCK_PATH_RE.test(relative(root, file))) continue; // declared mock territory

    const text = readFileSync(file, "utf8");
    const sf = parseSnippet(text, file.endsWith(".tsx") ? "snippet.tsx" : "snippet.ts");

    const push = (subtype: MockSubtype, node: Node, message: string) => {
      const loc = locationOf(node, file);
      const entry = entries.find((e) => e === file || reachableFrom(graph, e).has(file));
      const chain = entry ? importChain(graph, entry, file, root) : undefined;
      findings.push({
        id: findingId("MOCK", file, loc.line, subtype),
        kind: "MOCK",
        subtype,
        location: loc,
        message,
        chain: chain && chain.length > 1 ? chain : undefined,
        suppressed: isSuppressed(text, loc.line),
      });
    };

    sf.forEachDescendant((node) => {
      // 4.1 — a declared identifier that names itself a mock.
      if (Node.isVariableDeclaration(node)) {
        const name = node.getName();
        if (isMockName(name)) {
          const init = node.getInitializer();
          const shape = init
            ? Node.isObjectLiteralExpression(init)
              ? "object literal"
              : Node.isArrayLiteralExpression(init)
                ? "array literal"
                : "value"
            : "declaration";
          push(
            "identifier",
            node,
            `\`${name}\` (${shape}) is reachable from a production entry point`,
          );
        }
      }

      // 4.2 — an import of a mock symbol into production code.
      if (Node.isImportDeclaration(node)) {
        const spec = node.getModuleSpecifierValue();
        const named = node.getNamedImports().map((n) => n.getName());
        const hit = named.filter(isMockName);
        if (hit.length > 0) {
          push("identifier", node, `production module imports \`${hit.join(", ")}\` from "${spec}"`);
        } else if (MOCK_PATH_RE.test(spec)) {
          push("identifier", node, `production module imports from mock path "${spec}"`);
        }
      }

      // 4.3 — a hardcoded sample payload returned in place of real work,
      //       often behind a fake latency timer so the UI looks alive.
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression().getText();
        if (/^(setTimeout|setInterval)$/.test(callee)) {
          const delay = node.getArguments()[1]?.getText();
          const body = node.getArguments()[0]?.getText() ?? "";
          if (delay && /^\d{3,}$/.test(delay) && /\b(MOCK|DEMO|FAKE|SAMPLE|mock|demo|fake)/.test(body)) {
            push(
              "hardcoded-sample",
              node,
              `fake ${delay}ms delay in front of placeholder data: the UI imitates a real request`,
            );
          }
        }
      }
    });
  }

  return findings;
}
