# Prior art, and what is actually new here

Checked 2026-08-23. Written because a judge who knows this space will ask, and because a tool about honest verification that oversells itself is self-refuting.

## What already exists, and does it better

**[StrykerJS](https://stryker-mutator.io/docs/stryker-js/introduction/)** — a mature, dedicated JavaScript mutation testing framework. For mutation testing specifically, **Stryker is better than canfail and it is not close.** It has a far larger mutator catalogue, incremental runs, per-test coverage analysis to avoid re-running irrelevant tests, HTML reporting, and a mutation score you can track over time.

canfail's `SURVIVED` detector is a deliberately small mutation probe: four operators, one mutant per source line, a per-test budget, no score. It exists so that a single command gives you a mutation signal alongside the other three, not because it competes with Stryker. **If mutation score is what you want, run Stryker.**

**[eslint-plugin-vitest](https://github.com/vitest-dev/eslint-plugin-vitest)** ships `expect-expect` (a test with no assertion), `no-disabled-tests`, `no-focused-tests`, and `no-conditional-expect`. **[Biome](https://biomejs.dev/linter/rules/no-skipped-tests/)** ships `noSkippedTests`, covering `.skip`, `.fixme`, `xit`, and bracket-notation variants.

Those overlap with four of canfail's six `VACUOUS` subtypes: `no-assertion`, `skipped` (both `.skip` and `.only`), and `unreachable-assertion`. If you already run either linter with those rules enabled, canfail's `VACUOUS` output will largely repeat what you have.

## What canfail does that they do not

| Capability | Prior art | canfail |
|---|---|---|
| `UNEARNED` — a changed test must fail against the base revision | **none found** | `canfail prove --base <ref>` |
| `MOCK` — placeholder data *reachable from a production entry point*, with the import chain | linters match names, none do reachability | `src/detectors/mock.ts` |
| `SILENT` — `ok: true` / `200` returned from inside a `catch`; HTTP 200 with an empty body | `no-empty` catches an empty block, not one that returns success | `src/detectors/silent.ts` |
| `tautological` — `expect(true).toBe(true)`, `expect(1).toBe(1)` | no rule found in eslint-plugin-vitest or Biome | `src/detectors/vacuous.ts` |
| A scanner that proves it can fail, against a manifest of planted defects | not a thing tools ship | `verify-fixtures` + `prove-gate-can-fail.sh` |

### The one that matters

Every CI system enforces that tests **pass on the branch**. None enforces that a new test would have **failed on the base commit**.

That gap is where AI-assisted development actually leaks. When the same session writes the fix and the test, the test tends to describe the implementation rather than pin the behaviour. It is green before the change and green after it. Coverage rises. Nothing was constrained.

`canfail prove` reverts the changed source files to the base revision, runs the changed test files against that old code, and requires them to go red. `scripts/demo-prove.sh` builds a throwaway repo and shows two tests that are both green on the branch, where only one exits 0.

I searched for an existing implementation of this invariant and did not find one. **That is a search result, not a proof of absence** — if it exists, canfail is a worse version of it and this section should say so.

## Honest positioning

canfail is not the best mutation tester and not a replacement for a linter. It is a single gate for one specific question — *can this check fail?* — that combines four cheap static signals, a small mutation probe, and one invariant nothing else enforces, and then holds itself to the same standard via a planted-defect manifest.

If you strip out everything with prior art, what remains is `prove`, `MOCK` reachability, `SILENT`, and the self-verification discipline. That is the honest core.
