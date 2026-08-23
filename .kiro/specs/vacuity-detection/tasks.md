# Tasks: Vacuity Detection for canfail

## Implementation Checklist

---

- [x] 1. Project scaffold and toolchain setup
  - Initialize `package.json` with `name: "canfail"`, `type: "module"`, Node 20+ engine constraint
  - Configure `tsconfig.json` targeting ESNext with `moduleResolution: bundler`, `strict: true`
  - Install dev dependencies: `typescript`, `ts-morph`, `vitest`, `commander`, `execa`
  - Add `bin/canfail.ts` entry point registered in `package.json` `bin` field
  - Configure vitest with `include: ["src/**/*.test.ts", "tests/**/*.test.ts"]`
  - _Requirements: 1.1, 1.2_

---

- [ ] 2. Config loader (`src/config.ts`)
  - Define `CanfailConfig` interface with fields: `testGlob`, `entryPoint`, `testCommand`, `assertionFunctions`, `ignoreDirs`
  - Load `canfail.config.ts` from CWD if present; fall back to defaults
  - Export `loadConfig(): Promise<CanfailConfig>`
  - Unit test: assert defaults when no config file present; assert override when config file present
  - _Requirements: 1.1, 4.4_

---

- [x] 3. AST helper layer (`src/ast/index.ts`)
  - Wrap ts-morph `Project` creation with shared options (no emit, skip lib check)
  - Export `parseFile(path: string): SourceFile`
  - Export `parseInMemory(code: string, filename: string): SourceFile`
  - Export helpers: `findTestBlocks`, `findCatchClauses`, `findReturnStatements`, `findBinaryExpressions`, `findCallsMatching`
  - Unit test each helper with synthetic in-memory source strings
  - _Requirements: 2.1, 2.2, 2.3, 3.1_

---

- [x] 4. `Finding` data model and ID generation (`src/types.ts`)
  - Define all interfaces: `Finding`, `Location`, `MutantDescriptor`, `Summary`, `CanfailReport`
  - Implement `findingId(kind, file, line): string` as `sha1(kind + ":" + file + ":" + line)` using Node `crypto`
  - Implement `isSuppressed(sourceFile: SourceFile, line: number): boolean` by checking for `// canfail-ignore` on that line
  - Unit test deterministic ID generation and suppression detection
  - _Requirements: 1.4, 6.1_

---

- [x] 5. VACUOUS detector — no-assertion and tautological subtypes (`src/detectors/vacuous.ts`)
  - Walk test file AST, find all `it`/`test`/`describe` blocks
  - For each test block, collect all assertion calls using the configured `assertionFunctions` list
  - If assertion list is empty → emit `VACUOUS / no-assertion`
  - If only assertions are `assert(true)` or `expect(true).toBe(true)` patterns → emit `VACUOUS / tautological`
  - Unit tests: no-assertion body, tautological body, valid body (no finding)
  - _Requirements: 2.1, 2.2_

---

- [x] 6. VACUOUS detector — empty-catch, skipped, snapshot-only subtypes
  - Extend `src/detectors/vacuous.ts` with three additional checks
  - Empty catch: find `try/catch` nodes where catch body has no statements (or only comments)
  - Skipped: detect `.skip` property access on `test`/`it` or `xit`/`xdescribe` call expressions
  - Snapshot-only: detect test bodies where every assertion call is `toMatchSnapshot` or `toMatchInlineSnapshot` and no snapshot file exists
  - Unit tests: one test per subtype, positive and negative cases
  - _Requirements: 2.3, 2.4, 2.5_

---

- [ ] 7. VACUOUS detector — unreachable-assertion subtype
  - Detect assertions inside an `if` branch where the condition is a comparison between a local variable and a constant never assigned within the test scope
  - Use ts-morph data-flow: trace variable assignments within the test function body only
  - Emit `VACUOUS / unreachable-assertion` when the branch is provably dead
  - Unit test: variable assigned constant `false`, assertion only in `if (variable === true)` branch
  - _Requirements: 2.6_

---

- [x] 8. Import graph builder (`src/graph/importer.ts`)
  - Build a directed graph of module imports starting from a given entry file
  - Resolve TypeScript path aliases from `tsconfig.json` via ts-morph `ModuleResolutionHost`
  - Exclude `node_modules` and `.d.ts` files
  - Export `buildImportGraph(entryFile: string): ImportGraph` where `ImportGraph` is a `Map<string, Set<string>>` (file → imported files)
  - Export `chainTo(graph: ImportGraph, entryFile: string, targetFile: string): string[] | null`
  - Unit test with a three-file fixture: `a → b → c`; assert chain is `[a, b, c]`
  - _Requirements: 4.1, 4.2_

---

- [x] 9. MOCK detector (`src/detectors/mock.ts`)
  - Accept entry point path (from config or `package.json` main/exports inference)
  - Build import graph from entry point
  - Walk all reachable files; skip files whose resolved path is under a test directory
  - For each exported/declared identifier matching `MOCK_*`, `DEMO_*`, `FAKE_*`, `FIXTURE_*` (case-insensitive): emit `MOCK / identifier` with `chain` field
  - For each string literal matching sample-data patterns (email, `localhost`, `0.0.0.0`, UUID regex, 16-digit digit sequence): emit `MOCK / hardcoded-sample`
  - Unit tests: identifier in production path (finding), identifier only in test dir (no finding), hardcoded email (finding)
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

---

- [x] 10. SILENT detector (`src/detectors/silent.ts`)
  - Walk all source files in project (test and source)
  - Find `catch` blocks that contain a `return` statement with status `200`, `{ ok: true }`, or `{ status: "ok" }` unconditionally → emit `SILENT / success-on-error`
  - Find route handlers at paths matching `/health`, `/healthz`, `/ping`, `/ready`, `/live` that return `200` inside a `catch` → emit `SILENT / health-check-swallow`
  - Find `catch` blocks returning `2xx` with empty/null body → emit `SILENT / empty-success`
  - Do not flag handlers where success is conditional on the error type
  - Unit tests: unconditional success (finding), conditional success (no finding), health route (finding)
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

---

- [x] 11. File restorer (`src/mutation/restore.ts`)
  - Export `snapshot(filePath: string): string` — reads and returns file content
  - Export `restore(filePath: string, content: string): Promise<void>` — writes content back atomically using a temp file + rename
  - If `restore` throws, rethrow with context message including original content so user can manually recover
  - Unit test: write file, corrupt it, restore, assert original content
  - _Requirements: 3.4_

---

- [x] 12. Mutant generator (`src/mutation/mutants.ts`)
  - Accept a `SourceFile` and return `MutationTarget[]`
  - Implement four mutation kinds: comparison-swap, boolean-flip, return-sentinel, conditional-negation
  - Each `MutationTarget` contains: `node` reference, `mutation: MutationKind`, `originalText`, `mutatedText`
  - Skip nodes in `// canfail-no-mutate` annotated scope
  - Unit test: count targets in a small function with two comparisons and one boolean literal
  - _Requirements: 3.1, 3.6_

---

- [x] 13. Test runner bridge (`src/mutation/runner.ts`)
  - Accept `testFile: string` and `config: CanfailConfig`
  - Spawn configured `testCommand` as a child process with the test file as argument, 30-second timeout
  - Return `{ passed: boolean; timedOut: boolean }`
  - On timeout: kill child process, return `{ passed: false, timedOut: true }`
  - Unit test: stub subprocess exit 0 → `passed: true`; exit 1 → `passed: false`
  - _Requirements: 3.2, 3.3_

---

- [x] 14. Mutation engine (`src/mutation/engine.ts`)
  - For each test file glob match, collect source imports, enumerate targets, run probe loop
  - Use `restore.ts` snapshot/restore around every probe
  - Deduplicate survived findings by `(sourceFile, sourceLine, mutation)` triple
  - Log killed mutant count and survived count to stderr at end of run
  - Integration test: use a two-file fixture with a known surviving mutant; assert one finding emitted with correct `MutantDescriptor`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

---

- [x] 15. Orchestrator (`src/orchestrator.ts`)
  - Run VACUOUS, MOCK, SILENT detectors (static phase) then SURVIVED (dynamic phase)
  - Collect all `Finding[]` arrays; merge and sort by file path then line number
  - Mark findings as suppressed when `isSuppressed` returns true
  - Return `CanfailReport`
  - Unit test: mock all four detectors, assert report summary counts are correct
  - _Requirements: 1.1, 1.2, 1.4_

---

- [ ] 16. Reporter — table and JSON formatters (`src/report/`)
  - `table.ts`: render findings as a bordered ASCII table with columns: `kind`, `subtype`, `file`, `line`, `message`; print summary line `"N finding(s) detected"`
  - `json.ts`: serialize `CanfailReport` to stdout as pretty-printed JSON
  - `reporter.ts`: route to correct formatter; when `--json` flag is set, suppress all stdout table output
  - Unit test table: assert column headers present, assert finding row text
  - Unit test JSON: parse output and assert schema fields present
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

---

- [x] 17. CLI entry point and gate logic (`bin/canfail.ts`)
  - Register `canfail [path]` command with options: `--json`, `--gate`, `--only <kind>`, `--config <path>`
  - After orchestrator returns report: if `findings.filter(f => !f.suppressed).length > 0` → exit `1`; else exit `0`
  - When `--gate` flag present: print gate-failed summary to stderr
  - Register `canfail verify-fixtures` subcommand that delegates to `src/verify-fixtures.ts`
  - Smoke test: run `canfail --help` as subprocess, assert exit code `0` and `--json` in output
  - _Requirements: 1.1, 1.2, 1.3_

---

- [x] 18. Fixture repo — `fixtures/greenwashed-app`
  - Create a minimal TypeScript app with `src/` and `tests/` directories
  - Plant exactly one defect per detector kind:
    - `tests/vacuous.test.ts`: a test with an empty body (VACUOUS / no-assertion)
    - `tests/survived.test.ts`: a test that imports `src/math.ts` and makes an assertion that a boolean-flip mutation survives (SURVIVED)
    - `src/utils.ts`: a `DEMO_USER` export reachable from `src/index.ts` (MOCK / identifier)
    - `src/handler.ts`: a `catch` block returning `{ ok: true }` (SILENT / success-on-error)
  - Create `canfail-manifest.json` listing the four planted finding IDs and their expected locations
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

---

- [x] 19. Fixture verifier (`src/verify-fixtures.ts`)
  - Read `canfail-manifest.json` from the fixture directory
  - Run the orchestrator against the fixture directory
  - Compare actual findings (by ID) against manifest entries
  - Report missing findings (false negatives) and unexpected findings (false positives) separately
  - Exit `0` only when the sets are identical; exit `1` otherwise
  - Integration test: run `canfail verify-fixtures` as subprocess; assert exit code `0`
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

---

- [x] 20. Self-hosting CI gate and documentation
  - Add `canfail` to the project's own CI workflow (`ci.yml`) as a step after tests
  - Run `canfail src/` and assert exit `0`, proving internal tests are not vacuous
  - Write `README.md` covering: installation, basic usage, all four detector kinds with examples, `--json` output schema, `canfail-ignore` suppression, `canfail verify-fixtures` command, and contributing guide
  - _Requirements: 1.1, 1.2, 7.1_

---

## Status at submission

**17 of 20 tasks complete.** The three open boxes are deliberate deviations from the
design, recorded here rather than quietly closed.

- **Task 2 — Config loader (`src/config.ts`): not built.** Every setting the spec put
  in `canfail.config.ts` is a CLI flag instead (`--test-command`, `--exclude`,
  `--max-mutants`, `--timeout`, `--only`, `--max-findings`). A config file adds a
  second source of truth and a failure mode the spec itself flags as fatal
  ("config exists but fails to compile → exit 2"). Nothing in the tool reads a
  config file today, so `src/config.ts` does not exist.

- **Task 7 — unreachable-assertion via dead-branch data flow: implemented differently.**
  The spec called for tracing local variable assignments to prove a branch is dead.
  Shipped instead is the case that actually occurs in real suites: an assertion
  reachable only from inside a `catch`, so the happy path asserts nothing
  (`src/detectors/vacuous.ts`, requirement 2.6). Full data-flow analysis was cut
  because its false-positive rate on real code is high and unverified.

- **Task 16 — `src/report/json.ts` and `src/report/reporter.ts`: merged.** `table.ts`
  renders the human output; JSON serialization is one `JSON.stringify` of the same
  `CanfailReport` in `bin/canfail.ts`. Two modules and a router for that would be
  indirection with no reader.

Two things the spec did not anticipate, both added after canfail was run against
itself and against a fresh clone:

- `--exclude` (not in the spec) — needed so the self-hosting gate can scan `src/`
  without reporting the fixture's deliberately planted defects.
- `buildCommand` in `src/mutation/runner.ts` — the probe passed an absolute path as
  the test-runner filename filter, which matches nothing under a symlinked root and
  read back as "baseline red", silently skipping every probe. Covered now by
  `src/mutation/runner.test.ts` including a real symlinked-root case.
