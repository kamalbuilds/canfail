/**
 * Deterministic mutant catalogue.
 * Requirement 3.2. Four mutation kinds, fixed ordering, no randomness:
 * two runs over unchanged code must produce the identical mutant list.
 */
import { Node, hasNoMutateMarker, parseSnippet } from "../ast/index.js";
import type { MutationKind } from "../types.js";
import { readFileSync } from "node:fs";

export interface MutationTarget {
  kind: MutationKind;
  file: string;
  line: number;
  column: number;
  /** Absolute character offsets into the original file text. */
  start: number;
  end: number;
  originalText: string;
  mutatedText: string;
}

/** Swap each comparison to a neighbour that changes the boundary or the sense. */
const COMPARISON_SWAP: Record<string, string> = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": "<=",
  "<=": "<",
  ">": ">=",
  ">=": ">",
};

const MAX_MUTATED_TEXT = 120;

export function collectMutationTargets(file: string, sourceText?: string): MutationTarget[] {
  const text = sourceText ?? readFileSync(file, "utf8");
  if (file.endsWith(".d.ts")) return [];
  const sf = parseSnippet(text, file.endsWith(".tsx") ? "snippet.tsx" : "snippet.ts");
  const targets: MutationTarget[] = [];

  const add = (
    kind: MutationKind,
    node: Node,
    start: number,
    end: number,
    originalText: string,
    mutatedText: string,
  ) => {
    const { line, column } = node.getSourceFile().getLineAndColumnAtPos(start);
    if (hasNoMutateMarker(text, line)) return;
    if (mutatedText.length > MAX_MUTATED_TEXT) return;
    targets.push({ kind, file, line, column, start, end, originalText, mutatedText });
  };

  sf.forEachDescendant((node) => {
    // comparison-swap
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken();
      const opText = op.getText();
      const swapped = COMPARISON_SWAP[opText];
      if (swapped) {
        add("comparison-swap", op, op.getStart(), op.getEnd(), opText, swapped);
      }
    }

    // boolean-flip
    if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
      const original = node.getText();
      add("boolean-flip", node, node.getStart(), node.getEnd(), original, original === "true" ? "false" : "true");
    }

    // return-sentinel: replace a returned expression with a value nothing should accept.
    if (Node.isReturnStatement(node)) {
      const expr = node.getExpression();
      if (expr && !Node.isTrueLiteral(expr) && !Node.isFalseLiteral(expr)) {
        const t = expr.getText();
        if (t !== '"__canfail_sentinel__"' && t.length <= MAX_MUTATED_TEXT) {
          add("return-sentinel", expr, expr.getStart(), expr.getEnd(), t, '"__canfail_sentinel__" as never');
        }
      }
    }

    // conditional-negation
    if (Node.isIfStatement(node) || Node.isWhileStatement(node)) {
      const cond = node.getExpression();
      add("conditional-negation", cond, cond.getStart(), cond.getEnd(), cond.getText(), `!(${cond.getText()})`);
    }
    if (Node.isConditionalExpression(node)) {
      const cond = node.getCondition();
      add("conditional-negation", cond, cond.getStart(), cond.getEnd(), cond.getText(), `!(${cond.getText()})`);
    }
  });

  // Stable ordering: by position, then by kind name.
  targets.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
  return targets;
}

export function applyMutation(originalText: string, target: MutationTarget): string {
  return originalText.slice(0, target.start) + target.mutatedText + originalText.slice(target.end);
}
