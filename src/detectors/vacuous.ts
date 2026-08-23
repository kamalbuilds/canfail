/**
 * VACUOUS detector — tests that are green because they cannot go red.
 * Requirements 2.1 - 2.6 (.kiro/specs/vacuity-detection/requirements.md).
 */
import {
  Node,
  collectAssertions,
  collectTestCases,
  isSuppressed,
  locationOf,
  parseSnippet,
} from "../ast/index.js";
import type { Finding, VacuousSubtype } from "../types.js";
import { findingId } from "../types.js";
import { readFileSync } from "node:fs";

const SNAPSHOT_MATCHERS = new Set([
  "toMatchSnapshot",
  "toMatchInlineSnapshot",
  "toMatchFileSnapshot",
]);

/** `expect(1).toBe(1)`, `assert(true)`, `expect(true).toBe(true)` — true regardless of the code. */
function isTautological(subject: string | undefined, matcher: string | undefined, args: string[]): boolean {
  if (!subject) return false;
  const s = subject.trim();
  const literal = /^(true|false|\d+(\.\d+)?|'[^']*'|"[^"]*"|`[^`$]*`)$/.test(s);
  if (!literal) return false;
  // A literal subject compared against a literal expectation is a tautology.
  if (!matcher) return true; // bare assert(true)
  if (args.length === 0) return true;
  const arg = args[0].trim();
  return /^(true|false|\d+(\.\d+)?|'[^']*'|"[^"]*"|`[^`$]*`)$/.test(arg);
}

export function detectVacuous(filePath: string, sourceText?: string): Finding[] {
  const text = sourceText ?? readFileSync(filePath, "utf8");
  const sf = parseSnippet(text, filePath.endsWith(".tsx") ? "snippet.tsx" : "snippet.ts");
  const findings: Finding[] = [];

  const push = (subtype: VacuousSubtype, node: Node, message: string) => {
    const loc = locationOf(node, filePath);
    findings.push({
      id: findingId("VACUOUS", filePath, loc.line, subtype),
      kind: "VACUOUS",
      subtype,
      location: loc,
      message,
      suppressed: isSuppressed(text, loc.line),
    });
  };

  for (const tc of collectTestCases(sf)) {
    // 2.4 — skipped / only / todo tests never prove anything in CI.
    if (tc.modifier === "skip" || tc.modifier === "todo" || tc.modifier === "failing") {
      push("skipped", tc.callNode, `\`${tc.callee}\` never executes: "${tc.title}"`);
      continue;
    }
    if (tc.modifier === "only") {
      push("skipped", tc.callNode, `\`${tc.callee}\` silences every other test in this file`);
    }

    if (!tc.body) continue;
    const assertions = collectAssertions(tc.body);

    // 2.1 — a test body with no assertion at all.
    if (assertions.length === 0) {
      push("no-assertion", tc.callNode, `test "${tc.title}" contains no assertion`);
      continue;
    }

    // 2.5 — snapshot-only tests assert "it did not change", never "it is correct".
    if (assertions.every((a) => a.matcher && SNAPSHOT_MATCHERS.has(a.matcher))) {
      push(
        "snapshot-only",
        assertions[0].node,
        `test "${tc.title}" only asserts a snapshot; a wrong value is recorded as correct on first run`,
      );
    }

    for (const a of assertions) {
      // 2.2 — tautology: the assertion holds no matter what the code does.
      const args = Node.isCallExpression(a.node) ? a.node.getArguments().map((x) => x.getText()) : [];
      if (isTautological(a.subject, a.matcher, args)) {
        push("tautological", a.node, `\`${a.text}\` is true regardless of the code under test`);
      }

      // 2.6 — assertion sits inside a catch block, so a throw skips it silently.
      let cursor: Node | undefined = a.node.getParent();
      while (cursor && cursor !== tc.body) {
        if (Node.isCatchClause(cursor)) {
          push(
            "unreachable-assertion",
            a.node,
            `\`${a.text}\` only runs when the code throws; on the happy path nothing is asserted`,
          );
          break;
        }
        cursor = cursor.getParent();
      }
    }

    // 2.3 — try/catch that swallows the failure: the test passes whether or not the code throws.
    tc.body.forEachDescendant((node) => {
      if (!Node.isTryStatement(node)) return;
      const catchClause = node.getCatchClause();
      if (!catchClause) return;
      const block = catchClause.getBlock();
      const statements = block.getStatements();
      const hasThrow = block.getFullText().includes("throw ");
      const hasAssertion = collectAssertions(block).length > 0;
      const hasFailCall = /\b(fail|expect\.fail|assert\.fail)\s*\(/.test(block.getFullText());
      if (statements.length === 0 || (!hasThrow && !hasAssertion && !hasFailCall)) {
        push(
          "empty-catch",
          catchClause,
          `catch block swallows the failure: test "${tc.title}" passes whether or not the code throws`,
        );
      }
    });
  }

  return findings;
}
