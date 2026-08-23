# DEVLOG: canfail

Development log for `canfail`, a CLI and CI gate that finds checks which cannot fail.

All timestamps are IST (UTC+5:30) and correspond to real commits in this repository. Every
claim below is verifiable with `git log`, `git show`, or by running the referenced script.

**Total elapsed:** 20:34 on 2026-08-23 to 04:26 on 2026-08-24, 7 hours 52 minutes, 14 commits.
**Final state:** 78 tests passing, 13/13 planted defects matched, all 13 CI gates green.

---

## Timeline

| Time | Commit | Milestone |
|---|---|---|
| 20:34 | `16efce2` | Core: four detectors, mutation probe, CLI |
| 20:35 | `7600a3c` | 28 unit tests for detectors, mutant generator, file guard |
| 20:46 | `66af6dd` | Fixed two false positives canfail found in canfail, added `--exclude` |
| 20:51 | `091e958` | Fixed a probe that silently skipped every test file under a symlinked root |
| 20:52 | `3d62722` | CI gate, spec task status, a swallow canfail found in its own import graph |
| 20:54 | `9b19fcf` | Demo script and one-command demo runner |
| 20:55 | `fc33a37` | `clean-app` negative fixture and 12 CLI integration tests |
| 22:27 | `e198928` | `canfail prove`: a changed test must fail against the base revision |
| 22:41 | `a5429fe` | `prove` works in any language whose tests live in their own files |
| 22:44 | `f61c158` | Language acceptance criteria in the spec, Go beat in the demo |
| 22:51 | `35c6408` | Real terminal screenshots, colorized `prove` output |
| 22:57 | `301b63b` | Crash journal and commit guard after a SIGKILL left a mutant committed |
| 22:59 | `ba445f9` | Fixed the mutant guard flagging its own source |
| 04:26 | `b4102be` | Corrected counts, verified language matrix, KiroCrew prove demo |

### Phase 1, 20:34 to 20:55: static detectors and the mutation probe

Built the four detectors (`VACUOUS`, `SURVIVED`, `MOCK`, `SILENT`) against the spec in
`.kiro/specs/vacuity-detection/`, then immediately built `fixtures/greenwashed-app`: a project
with a 100% passing test suite and 13 deliberately planted defects, catalogued in
`canfail-manifest.json`.

The fixture came before the polish on purpose. A scanner that prints "0 problems" is
indistinguishable from a scanner that is broken, so `verify-fixtures` asserting 13/13 and
nothing else became the primary correctness gate.

### Phase 2, 22:27 to 22:51: canfail prove

A prior-art review late in the evening produced the most important finding of the night: the
static detectors overlap substantially with existing tools. `expect-expect` and
`no-disabled-tests` in eslint-plugin-vitest and Biome's `noSkippedTests` already cover four of
the six `VACUOUS` subtypes, and StrykerJS is a better mutation tester. That is written out in
`PRIOR-ART.md` rather than hidden.

The gap that review exposed is what `canfail prove` fills. Every CI system enforces that tests
**pass on the branch**. None enforces that a new test would have **failed on the base commit**.
That invariant is where AI-assisted development leaks: when one session writes both the fix and
the test, the test tends to describe the implementation instead of pinning the behaviour.

### Phase 3, 22:57 to 04:26: crash safety and honesty passes

Two fix commits driven by real failures (below), then a documentation pass that corrected stale
counts and replaced broad language claims with a verification matrix distinguishing
"exercised in CI" from "pattern supported".

---

## Technical decisions and rationale

**Pass/fail is the subprocess exit code, never parsed test output.**
`canfail` never reads a test runner's stdout. This is why it works with vitest, jest, mocha, and
`node --test` with no adapters, and why `prove` extends to `go test` and `pytest` unchanged. The
cost is losing per-test granularity: a file is red or green, nothing finer.

**The mutation catalogue is fixed and deterministic, not random.**
Four kinds: comparison swap, boolean flip, return sentinel, conditional negation. Sorted output,
so two runs produce an identical list. Random mutation would make the gate flaky, and a flaky
gate gets disabled.

**A timeout counts as a killed mutant, not a survivor.**
A hung test is evidence the mutation had an effect. The conservative direction is to
under-report survivors, because a false `SURVIVED` finding costs developer trust.

**Only the first mutant per source line is attempted.**
Spreads a fixed budget across lines rather than concentrating it. Surviving mutants prove a gap;
their absence does not prove coverage, and the README says so.

**Rust unit tests are detected and skipped with the reason printed.**
Idiomatic Rust puts tests in `#[cfg(test)] mod tests` inside the source file. Reverting that file
to its base revision deletes the test being evaluated. Reporting a pass there would be a lie of
exactly the kind this tool exists to catch, so it refuses and explains.

**Only TypeScript and JavaScript get import-closure scoping in `prove`.**
Every other language reverts the whole changed surface of the same language, which is the
stricter reading of the invariant: the test must fail against the change as a whole.

**The AST detectors were designed by hand, not generated.**
The four detector heuristics and the mutation catalogue encode judgement about which patterns
are false positives. Kiro wrote the spec set and the steering docs and drove the implementation
against them. That division is stated in the README rather than implied.

---

## Challenges faced and solutions implemented

### 1. A SIGKILL left a mutant in a committed fixture

**The failure.** While generating the README terminal images, the screen-capture tool hit its own
timeout and SIGKILLed `canfail` mid-probe. No signal handler runs on SIGKILL, so
`fixtures/greenwashed-app/src/scoring.ts` was left with `containsAllergen` returning
`"__canfail_sentinel__"`. It went into a commit and surfaced three commits later as a CI failure
that looked like something else entirely: a green-looking local run, a broken artifact. Precisely
the defect class this tool is named after, in this tool's own repository.

**Why the existing guards missed it.** `FileGuard` handles SIGINT, SIGTERM, and
`uncaughtException`, and `verifyClean()` refuses a clean exit if any file differs from its
snapshot. None of that can run when the process is killed outright.

**The fix, in two parts** (`301b63b`):
1. A **crash journal**. Before a file is mutated, its original bytes are copied to
   `.canfail-backup/` and recorded in `.canfail-journal.json`. Every subsequent run reads the
   journal before anything else, repairs the tree, and reports what it repaired. A missing backup
   is reported rather than silently treated as success, and the journal is deleted only after
   verification passes.
2. A **commit guard**, `scripts/no-mutants-committed.sh`, which fails when a mutation artifact is
   tracked by git. It runs first in CI.

**How it is proven.** `tests/integration/crash-recovery.test.ts` spawns a real probe, **SIGKILLs
it**, asserts the tree is genuinely dirty, and requires the next run to restore it byte for byte.

The honest form of the invariant: canfail cannot guarantee it is never killed mid-mutation, so it
guarantees the damage is recorded, repaired on the next run, and blocked at the commit.

### 2. The commit guard flagged its own source

The guard searches for the sentinel string `__canfail_sentinel__`. Its own source contains that
string in order to search for it, so it reported itself and turned CI red (`ba445f9`). Fixed by
excluding the guard's own path. A small bug worth logging because it is the same category as the
false positives below: a checker that cannot distinguish a pattern from a mention of a pattern.

### 3. canfail found two false positives in canfail

Running `node dist/bin/canfail.js scan . --exclude fixtures` returned 23 findings on the first
self-scan. Two were genuine bugs in canfail itself (`66af6dd`):

- Pattern constants such as `MOCK_ID_RE` were reported as reachable mock data. A regex named
  `MOCK_*` is not placeholder data.
- `catch` blocks that report the error through a callback were read as silent swallows. Reporting
  through a callback is handling, not swallowing.

Both were fixed in `src/detectors/mock.ts` and `src/detectors/silent.ts`, and `verify-fixtures`
still matched 13/13 afterwards. That regression is exactly what the
`verify-fixtures-on-detector-change` hook guards.

### 4. Six surviving mutants exposed four gaps in canfail's own test suite

The same self-scan produced six genuine `SURVIVED` findings:

| Mutant that survived | What it proved was untested |
|---|---|
| `args.length === 0` negated in `vacuous.ts` | no test distinguished a literal expectation from a computed one |
| `!matcher` negated in `vacuous.ts` | the zero-argument matcher path was unconstrained |
| `file.endsWith(".tsx")` negated in `mutants.ts` | `.tsx` files were parsed as plain TypeScript and nothing noticed |
| `snapshot()` return replaced with a sentinel in `restore.ts` | nothing asserted on what the guard hands back |

The suite went from 28 to 33 tests as a direct result. This is the clearest evidence the tool
works: it found real gaps in the test suite of the project that produced it.

### 5. The probe silently skipped every test file under a symlinked root

On macOS the working path resolved through a symlink, so absolute paths from the import graph
never matched the paths the probe iterated. The probe reported success while testing nothing, a
silent no-op (`091e958`). Fixed by normalising to real paths before comparison. The category is
the one `SILENT` exists to detect, which is why it is logged here.

### 6. canfail prove was built before its spec

`prove` was implemented during the prior-art review, ahead of writing its requirements. The spec
now exists at `.kiro/specs/unearned-tests/` with 6 user stories, 28 EARS criteria, and 26 tasks,
and its first section is a `## Provenance` note stating plainly that this feature was **not**
spec-first, unlike `vacuity-detection`. Recording the deviation is worth more than a spec set
that pretends to a process it did not follow.

### 7. Proving the gate itself can fail

`verify-fixtures` passing is only meaningful if it is capable of failing.
`scripts/prove-gate-can-fail.sh` breaks a detector, asserts the gate goes red, restores it, and
asserts it goes green again. Applying the project's own thesis one level up to its own CI.

---

## Kiro CLI usage

**Spec-driven development.** Two complete spec sets under `.kiro/specs/`:

| Spec | Stories | EARS criteria | Tasks |
|---|---|---|---|
| `vacuity-detection/` | 7 | 32 | 20 (17 checked, 3 documented deviations) |
| `unearned-tests/` | 6 | 28 | 26 |

The traceability is load-bearing, not decorative. Each detector's header cites the criteria it
implements: `vacuous.ts` to 2.1-2.6, `mock.ts` to 4.1-4.4, `silent.ts` to 5.1-5.4, `engine.ts`
to 3.1-3.6. The `design.md` interfaces (`Finding`, `MutantDescriptor`, `CanfailReport`) are
implemented verbatim in `src/types.ts`.

The three deviations in `tasks.md` are recorded rather than quietly closed: config-file settings
became CLI flags, full dead-branch analysis became the lower-false-positive catch-only case, and
direct JSON serialization replaced two planned reporter modules.

**Steering,** `.kiro/steering/`: `product.md` (what canfail is, four personas, non-goals),
`tech.md` (Node 20+, ESM, strict TypeScript, ts-morph), `structure.md` (layout, naming, import
boundaries). Three hard constraints in `tech.md` were enforced across every file Kiro touched:
**no network calls, no paid APIs, no untrusted code execution.** The tool makes zero outbound
requests and has zero ongoing cost.

**Agent hooks,** `.kiro/hooks/verify-fixtures-on-detector-change.json`, three hooks:

| Hook | Trigger | Action |
|---|---|---|
| `verify-fixtures-on-detector-change` | save under `src/detectors/` or `src/mutation/` | command: rebuild and re-run fixture verification |
| `spec-traceability-reminder` | save under `src/detectors/` | agent: check the file against `requirements.md`, flag behaviour no criterion covers |
| `prove-new-tests-are-earned` | save any `.test.ts` / `.spec.js` | command: build and run `canfail prove --base HEAD` |

The third one is the project eating its own dog food: a generated test that also passes against
the old code is reported at save time instead of waiting for CI.

---

## Verification

Everything below was executed on the final commit.

| Check | Result |
|---|---|
| `npm run build` | clean |
| `npx vitest run` | 10 files, **78/78 passed** (31 integration) |
| `npm run verify:fixtures` | **13/13 planted defects matched**, no extras |
| `npm run demo:clean` | 3/3 mutants killed, zero findings |
| `./scripts/prove-gate-can-fail.sh` | green, then red on a broken detector, then green |
| `./scripts/no-mutants-committed.sh` | pass |
| `./scripts/demo-prove.sh` (TypeScript) | UNEARNED exit 1, EARNED exit 0 |
| `./scripts/demo-prove-go.sh` (real Go module) | UNEARNED exit 1, EARNED exit 0 |
| `canfail scan . --exclude fixtures` | self-hosting gate passes |
| GitHub Actions | all 13 gates green |

**Repository:** 76 tracked files, 23 TypeScript source files.

The negative fixture matters as much as the broken one. `fixtures/clean-app` must produce zero
findings, and it runs in CI on every push. It is the check that stops canfail from degenerating
into a finding generator.

---

## What is not done

Stated here because a tool about honest verification should be honest about itself.

- Static scan and mutation probe are TypeScript and JavaScript only. `prove` spans more
  languages, but only TypeScript, JavaScript, and Go are verified end to end in CI. Python, Ruby,
  and Java are pattern supported with unit tests and no end-to-end run, and are listed as
  unverified for that reason.
- Import resolution is file based. It does not resolve `tsconfig` path aliases or bare package
  specifiers, so a project reaching its UI exclusively through an alias will under-report `MOCK`.
- `MOCK` is heuristic on naming. A placeholder named `realProductData` will not be flagged.
- The probe budget is per test file, so a full run samples the mutation space rather than
  exhausting it.
- Writing Go or Python AST detectors for `VACUOUS`, `MOCK`, and `SILENT` is real work. Claiming it
  without a fixture would be exactly the defect this tool exists to catch, so it was not claimed.

Next, in order: SARIF output with GitHub Code Scanning annotations, a native GitHub Action,
`canfail init --kiro` for hook generation, an MCP tool interface for coding agents, then Go
`VACUOUS` and `SILENT`.
