/**
 * Thin typed wrappers over ts-morph.
 * Every detector goes through here so parse behaviour is identical across detectors.
 */
import { Node, Project, SourceFile, SyntaxKind, ts } from "ts-morph";
import type { Location } from "../types.js";

export const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;

/** Test-runner entry calls whose callback bodies are the unit of judgement. */
const TEST_FN_NAMES = new Set(["it", "test", "specify"]);
const SUITE_FN_NAMES = new Set(["describe", "suite", "context"]);

/** Assertion vocabularies we recognise across vitest / jest / node:assert / chai. */
const ASSERT_ROOTS = new Set(["expect", "assert", "should", "chai"]);

export function createProject(tsConfigFilePath?: string): Project {
  if (tsConfigFilePath) {
    return new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  }
  return new Project({
    useInMemoryFileSystem: false,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
}

/** Parse a standalone snippet. Used by unit tests and by callers with no project on disk. */
export function parseSnippet(code: string, fileName = "snippet.ts"): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return project.createSourceFile(fileName, code, { overwrite: true });
}

export function locationOf(node: Node, file?: string): Location {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { file: file ?? sf.getFilePath(), line, column };
}

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

/**
 * A line carries a suppression when the line itself, or the line directly above it,
 * contains `canfail-ignore`. Suppression is always explicit; canfail never self-suppresses.
 */
export function isSuppressed(sourceText: string, line: number): boolean {
  const lines = sourceText.split(/\r?\n/);
  const own = lines[line - 1] ?? "";
  const above = lines[line - 2] ?? "";
  return /canfail-ignore/.test(own) || /canfail-ignore/.test(above);
}

export function hasNoMutateMarker(sourceText: string, line: number): boolean {
  const lines = sourceText.split(/\r?\n/);
  const own = lines[line - 1] ?? "";
  const above = lines[line - 2] ?? "";
  return /canfail-no-mutate/.test(own) || /canfail-no-mutate/.test(above);
}

export interface TestCase {
  /** `it`, `test`, `it.skip`, `test.only`, ... */
  callee: string;
  /** Base name without modifier: `it` / `test`. */
  base: string;
  /** `skip` | `only` | `todo` | `concurrent` | undefined */
  modifier?: string;
  title: string;
  callNode: Node;
  /** Callback body, absent for `it.todo("...")`. */
  body?: Node;
}

/** Collect every `it()` / `test()` call in a source file, including modifiers. */
export function collectTestCases(sf: SourceFile): TestCase[] {
  const out: TestCase[] = [];
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    let base: string | undefined;
    let modifier: string | undefined;

    if (Node.isIdentifier(expr)) {
      base = expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      const root = expr.getExpression();
      if (Node.isIdentifier(root)) {
        base = root.getText();
        modifier = expr.getName();
      }
    }
    if (!base || !TEST_FN_NAMES.has(base)) return;

    const args = node.getArguments();
    const titleArg = args[0];
    const title =
      titleArg && (Node.isStringLiteral(titleArg) || Node.isNoSubstitutionTemplateLiteral(titleArg))
        ? titleArg.getLiteralText()
        : "<dynamic title>";

    const fnArg = args.find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
    out.push({
      callee: modifier ? `${base}.${modifier}` : base,
      base,
      modifier,
      title,
      callNode: node,
      body: fnArg ? (fnArg.asKind(SyntaxKind.ArrowFunction) ?? fnArg).getBody?.() ?? fnArg : undefined,
    });
  });
  return out;
}

export function isSuiteCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  const root = Node.isPropertyAccessExpression(expr) ? expr.getExpression() : expr;
  return Node.isIdentifier(root) && SUITE_FN_NAMES.has(root.getText());
}

export interface AssertionInfo {
  node: Node;
  /** Full call text, e.g. `expect(x).toBe(1)`. */
  text: string;
  /** Matcher name for expect-chains: `toBe`, `toMatchSnapshot`, ... */
  matcher?: string;
  /** First argument text of `expect(...)`, used for tautology detection. */
  subject?: string;
}

/** Find assertion calls inside a node. Recognises expect-chains and assert.* calls. */
export function collectAssertions(scope: Node): AssertionInfo[] {
  const out: AssertionInfo[] = [];
  scope.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    // Skip the head of a chain: in `expect(x).toBe(1)` the inner `expect(x)` is not
    // itself an assertion, and counting it double-reports every matcher.
    const parent = node.getParent();
    if (
      parent &&
      Node.isPropertyAccessExpression(parent) &&
      parent.getExpression() === node &&
      Node.isCallExpression(parent.getParent())
    ) {
      return;
    }

    const expr = node.getExpression();

    // expect(subject).matcher(...) — possibly through .not / .resolves / .rejects
    if (Node.isPropertyAccessExpression(expr)) {
      const matcher = expr.getName();
      let cursor: Node = expr.getExpression();
      while (Node.isPropertyAccessExpression(cursor)) cursor = cursor.getExpression();

      if (Node.isCallExpression(cursor)) {
        const inner = cursor.getExpression();
        if (Node.isIdentifier(inner) && ASSERT_ROOTS.has(inner.getText())) {
          out.push({
            node,
            text: node.getText(),
            matcher,
            subject: cursor.getArguments()[0]?.getText(),
          });
          return;
        }
      }
      // assert.equal(...) / assert.ok(...)
      if (Node.isIdentifier(cursor) && ASSERT_ROOTS.has(cursor.getText())) {
        out.push({ node, text: node.getText(), matcher, subject: node.getArguments()[0]?.getText() });
        return;
      }
    }

    // bare assert(...)
    if (Node.isIdentifier(expr) && ASSERT_ROOTS.has(expr.getText())) {
      out.push({ node, text: node.getText(), subject: node.getArguments()[0]?.getText() });
    }
  });
  return out;
}

/** True when the node is lexically inside a catch clause body. */
export function isInsideCatch(node: Node): boolean {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isCatchClause(cur)) return true;
    cur = cur.getParent();
  }
  return false;
}

export { Node, SyntaxKind };
export type { SourceFile, Project };
