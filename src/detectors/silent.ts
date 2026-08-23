/**
 * SILENT detector — production code that reports success while failing.
 * Requirements 5.1 - 5.4.
 *
 * This is the failure mode where a health endpoint prints five connection errors
 * and still returns "all checks OK": the check exists, runs, and cannot go red.
 */
import { Node, isSuppressed, locationOf, parseSnippet } from "../ast/index.js";
import type { Finding, SilentSubtype } from "../types.js";
import { findingId } from "../types.js";
import { readFileSync } from "node:fs";

const OK_KEY_RE = /^(ok|success|healthy|isValid|valid|passed|pass|alive|ready)$/i;
const HEALTH_NAME_RE = /(health|status|check|ping|probe|ready|alive|verify|validate)/i;

/** Does this expression represent an unconditional "everything is fine" value? */
function isSuccessLiteral(node: Node | undefined): { yes: boolean; why: string } {
  if (!node) return { yes: false, why: "" };

  const text = node.getText().trim();

  if (text === "true") return { yes: true, why: "returns `true`" };
  if (/^(200|0)$/.test(text)) return { yes: true, why: `returns \`${text}\`` };
  if (/^["'`](ok|healthy|success|up|pass(ed)?)["'`]$/i.test(text)) {
    return { yes: true, why: `returns \`${text}\`` };
  }

  if (Node.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const name = prop.getName().replace(/["']/g, "");
      const init = prop.getInitializer();
      if (!init) continue;
      const initText = init.getText().trim();
      if (OK_KEY_RE.test(name) && initText === "true") {
        return { yes: true, why: `returns \`{ ${name}: true }\`` };
      }
      if (/^status$/i.test(name) && /^(200|["'`](ok|healthy|up)["'`])$/i.test(initText)) {
        return { yes: true, why: `returns \`{ status: ${initText} }\`` };
      }
      if (/^(errors|failures|issues)$/i.test(name) && /^\[\s*\]$/.test(initText)) {
        return { yes: true, why: `returns \`{ ${name}: [] }\`` };
      }
    }
  }
  return { yes: false, why: "" };
}

/** Is this node the enclosing function's declared name, if any? */
function enclosingFunctionName(node: Node): string | undefined {
  let cur: Node | undefined = node;
  while (cur) {
    if (Node.isFunctionDeclaration(cur) || Node.isMethodDeclaration(cur)) {
      return cur.getName();
    }
    if (Node.isVariableDeclaration(cur)) return cur.getName();
    if (Node.isPropertyAssignment(cur)) return cur.getName();
    cur = cur.getParent();
  }
  return undefined;
}

export function detectSilent(filePath: string, sourceText?: string): Finding[] {
  const text = sourceText ?? readFileSync(filePath, "utf8");
  const sf = parseSnippet(text, filePath.endsWith(".tsx") ? "snippet.tsx" : "snippet.ts");
  const findings: Finding[] = [];

  const push = (subtype: SilentSubtype, node: Node, message: string) => {
    const loc = locationOf(node, filePath);
    findings.push({
      id: findingId("SILENT", filePath, loc.line, subtype),
      kind: "SILENT",
      subtype,
      location: loc,
      message,
      suppressed: isSuppressed(text, loc.line),
    });
  };

  sf.forEachDescendant((node) => {
    // 5.1 / 5.2 — a catch block that returns success.
    if (Node.isCatchClause(node)) {
      const block = node.getBlock();
      const fnName = enclosingFunctionName(node) ?? "<anonymous>";
      block.forEachDescendant((inner) => {
        if (!Node.isReturnStatement(inner)) return;
        const verdict = isSuccessLiteral(inner.getExpression());
        if (!verdict.yes) return;
        const isHealth = HEALTH_NAME_RE.test(fnName);
        push(
          isHealth ? "health-check-swallow" : "success-on-error",
          inner,
          isHealth
            ? `\`${fnName}\` catches the error and still ${verdict.why}: the check cannot report a failure`
            : `\`${fnName}\` ${verdict.why} from inside a catch block: the caller cannot tell this failed`,
        );
      });

      // A catch that neither rethrows, logs, nor returns anything is a pure swallow.
      const body = block.getFullText();
      if (
        block.getStatements().length === 0 ||
        (!/\bthrow\b/.test(body) && !/\breturn\b/.test(body) && !/console\.|log|report|record/i.test(body))
      ) {
        push(
          "success-on-error",
          node,
          `catch block discards the error without rethrowing, logging, or returning a failure`,
        );
      }
    }

    // 5.3 — an HTTP 200 emitted with an empty payload, indistinguishable from "no data".
    if (Node.isCallExpression(node)) {
      const callText = node.getExpression().getText();
      if (/\.(status|sendStatus)$/.test(callText)) {
        const arg = node.getArguments()[0]?.getText();
        if (arg === "200") {
          const stmt = node.getFirstAncestor((a) => Node.isExpressionStatement(a) || Node.isReturnStatement(a));
          const full = (stmt ?? node).getText();
          if (/\.(json|send)\(\s*(\{\s*\}|\[\s*\]|null|undefined|""|''|``)\s*\)/.test(full)) {
            push(
              "empty-success",
              node,
              `HTTP 200 with an empty body: a throttled or failed upstream is indistinguishable from a healthy empty result`,
            );
          }
        }
      }
    }
  });

  return findings;
}
