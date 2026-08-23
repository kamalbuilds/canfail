import { describe, expect, it } from "vitest";
import { detectVacuous } from "./vacuous.js";

const at = (code: string) => detectVacuous("/virtual/example.test.ts", code);

describe("VACUOUS detector", () => {
  it("flags a test body with no assertion", () => {
    const findings = at(`
      import { it } from "vitest";
      it("does a thing", () => {
        doTheThing();
      });
    `);
    expect(findings.map((f) => f.subtype)).toContain("no-assertion");
    expect(findings[0].location.line).toBe(3);
  });

  it("does not flag a test that asserts on a real value", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("adds", () => {
        expect(add(1, 2)).toBe(3);
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it("flags a tautology and reports the offending expression", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("works", () => {
        expect(true).toBe(true);
      });
    `);
    const tautology = findings.find((f) => f.subtype === "tautological");
    expect(tautology).toBeDefined();
    expect(tautology!.message).toContain("expect(true).toBe(true)");
  });

  it("reports a tautology exactly once per assertion", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("works", () => {
        expect(1).toBe(1);
      });
    `);
    expect(findings.filter((f) => f.subtype === "tautological")).toHaveLength(1);
  });

  // canfail's own probe proved the tautology rule was unconstrained on these two
  // paths: the literal-subject branch and the argument check could both be inverted
  // with the suite still green. These two tests kill those mutants.
  it("does not flag a literal subject compared against a computed value", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("matches the computed total", () => {
        expect(42).toBe(computeTotal(orders));
      });
    `);
    expect(findings.filter((f) => f.subtype === "tautological")).toHaveLength(0);
  });

  it("flags a literal subject with a zero-argument matcher", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("is truthy", () => {
        expect(1).toBeTruthy();
      });
    `);
    expect(findings.map((f) => f.subtype)).toContain("tautological");
  });

  it("flags a skipped test and a focused test", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it.skip("never runs", () => { expect(a()).toBe(1); });
      it.only("silences the rest", () => { expect(b()).toBe(2); });
    `);
    expect(findings.filter((f) => f.subtype === "skipped")).toHaveLength(2);
  });

  it("flags a catch block that swallows the failure", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("handles", async () => {
        try {
          await risky();
          expect(1).toBe(2);
        } catch (err) {
        }
      });
    `);
    expect(findings.map((f) => f.subtype)).toContain("empty-catch");
  });

  it("does not flag a catch block that rethrows", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("handles", async () => {
        try {
          await risky();
        } catch (err) {
          throw err;
        }
        expect(state()).toBe("done");
      });
    `);
    expect(findings.filter((f) => f.subtype === "empty-catch")).toHaveLength(0);
  });

  it("flags a snapshot-only test", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("renders", () => {
        expect(render()).toMatchSnapshot();
      });
    `);
    expect(findings.map((f) => f.subtype)).toContain("snapshot-only");
  });

  it("flags an assertion that only runs on the throwing path", () => {
    const findings = at(`
      import { it, expect } from "vitest";
      it("rejects bad input", async () => {
        try {
          await parse("bad");
        } catch (err) {
          expect(err.message).toBe("bad input");
        }
      });
    `);
    expect(findings.map((f) => f.subtype)).toContain("unreachable-assertion");
  });

  it("marks a finding suppressed when canfail-ignore is on the line above", () => {
    const findings = at(`
      import { it } from "vitest";
      // canfail-ignore
      it("intentionally empty", () => {});
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].suppressed).toBe(true);
  });
});
