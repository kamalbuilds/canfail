import { describe, expect, it } from "vitest";
import { applyMutation, collectMutationTargets } from "./mutants.js";

const targets = (code: string) => collectMutationTargets("/virtual/src.ts", code);

describe("mutant generator", () => {
  it("swaps a comparison operator", () => {
    const code = `export function ok(n: number) { return n >= 20; }`;
    const t = targets(code).find((x) => x.kind === "comparison-swap");
    expect(t).toBeDefined();
    expect(t!.originalText).toBe(">=");
    expect(t!.mutatedText).toBe(">");
    expect(applyMutation(code, t!)).toContain("n > 20");
  });

  it("flips a boolean literal", () => {
    const code = `export const enabled = true;`;
    const t = targets(code).find((x) => x.kind === "boolean-flip");
    expect(applyMutation(code, t!)).toBe(`export const enabled = false;`);
  });

  it("replaces a returned expression with a sentinel", () => {
    const code = `export function name() { return "kamal"; }`;
    const t = targets(code).find((x) => x.kind === "return-sentinel");
    expect(applyMutation(code, t!)).toContain(`"__canfail_sentinel__"`);
  });

  it("negates an if condition", () => {
    const code = `export function f(a: number) { if (a > 1) { return 1; } return 0; }`;
    const t = targets(code).find((x) => x.kind === "conditional-negation");
    expect(applyMutation(code, t!)).toContain("if (!(a > 1))");
  });

  it("produces a byte-identical target list on repeat runs", () => {
    const code = `export function f(a: number) { if (a >= 2) { return true; } return false; }`;
    expect(JSON.stringify(targets(code))).toBe(JSON.stringify(targets(code)));
  });

  // The probe showed the .tsx branch was unprotected: parsing a .tsx file as .ts
  // silently yields the wrong targets and no test noticed.
  it("parses a .tsx file as JSX rather than as plain TypeScript", () => {
    const code = `export const Badge = (props: { on: boolean }) => <span data-on={props.on ? true : false} />;`;
    const found = collectMutationTargets("/virtual/Badge.tsx", code);
    expect(found.filter((t) => t.kind === "boolean-flip").length).toBeGreaterThan(0);
    expect(found.some((t) => t.kind === "conditional-negation")).toBe(true);
  });

  it("skips a line marked canfail-no-mutate", () => {
    const code = `// canfail-no-mutate\nexport const enabled = true;`;
    expect(targets(code).filter((t) => t.kind === "boolean-flip")).toHaveLength(0);
  });

  it("leaves the source unchanged outside the mutated span", () => {
    const code = `export function f(a: number) { return a >= 1; }`;
    const t = targets(code).find((x) => x.kind === "comparison-swap")!;
    const mutated = applyMutation(code, t);
    expect(mutated.length).toBe(code.length - 1);
    expect(mutated.startsWith("export function f(a: number) { return a ")).toBe(true);
  });
});
