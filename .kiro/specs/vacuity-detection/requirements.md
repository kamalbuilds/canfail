# Requirements: Vacuity Detection for canfail

## Overview

`canfail` is a CLI and CI gate that proves a test suite **can fail**. It detects checks that are permanently green not because the code is correct, but because the test cannot exercise a real failure path. This document specifies requirements using EARS (Easy Approach to Requirements Syntax).

---

## User Stories and Acceptance Criteria

---

**User Story 1:** As a developer integrating `canfail` into a CI pipeline, I want the tool to exit with a non-zero code when vacuous tests are detected, so that the pipeline blocks a merge automatically without requiring manual inspection of the output.

**Acceptance Criteria:**

1.1. WHEN `canfail` is run against a project and one or more findings of any detector type are produced, THEN the process SHALL exit with code `1`.

1.2. WHEN `canfail` is run against a project and zero findings are produced across all detectors, THEN the process SHALL exit with code `0`.

1.3. WHEN `canfail` is invoked with `--gate` and the finding count exceeds zero, THEN it SHALL print a human-readable summary line `"Gate failed: N finding(s) detected"` to stderr before exiting with code `1`.

1.4. WHERE a finding is suppressed via an inline `// canfail-ignore` comment on the same line as the flagged statement, THEN it SHALL NOT count toward the gate total and SHALL NOT appear in the output.

---

**User Story 2:** As a developer reviewing test quality, I want the VACUOUS detector to identify test bodies that contain no reachable assertion, so that I can find tests that could never catch a regression regardless of what the source code does.

**Acceptance Criteria:**

2.1. WHEN a test function body contains zero calls to any assertion function (including `expect`, `assert`, `should`, `must`, and custom matchers registered via config), THEN the VACUOUS detector SHALL emit a finding with `kind: "VACUOUS"` and the file path and line number of the test.

2.2. WHEN a test body contains only `assert(true)` or `expect(true).toBe(true)` or an equivalent tautological assertion where both operands are literal `true`, THEN the VACUOUS detector SHALL emit a finding.

2.3. WHEN a test body contains a `try/catch` block where the `catch` clause body is empty or contains only a comment, THEN the VACUOUS detector SHALL emit a finding with `kind: "VACUOUS"` and subtype `"empty-catch"`.

2.4. WHEN a test is decorated with `.skip` or registered as `test.skip(...)` or `xit(...)`, THEN the VACUOUS detector SHALL emit a finding with subtype `"skipped"`.

2.5. WHEN a test body contains only snapshot assertions (`toMatchSnapshot`, `toMatchInlineSnapshot`) and no non-snapshot assertion, THEN the VACUOUS detector SHALL emit a finding with subtype `"snapshot-only"` on the first invocation when no existing snapshot file is present.

2.6. IF a test assertion is inside a branch that is only reachable when a variable equals a constant that is never set to that value within the test scope, THEN the VACUOUS detector SHALL emit a finding with subtype `"unreachable-assertion"`.

---

**User Story 3:** As a tech lead reviewing code quality gates, I want the SURVIVED detector to apply deterministic source mutations and re-run affected tests, so that I can find tests that pass even when the logic they are supposed to cover is broken.

**Acceptance Criteria:**

3.1. WHEN the SURVIVED detector targets a source symbol imported by a test file, THEN it SHALL apply each mutation in the deterministic mutation catalogue (comparison swap, boolean flip, return sentinel, conditional negation) independently as a separate probe.

3.2. WHEN a mutant is applied and the test file is re-executed and the suite result is still green (all tests pass), THEN the detector SHALL emit a finding with `kind: "SURVIVED"`, the mutant description, the source file path, and the line number mutated.

3.3. WHEN a mutant is applied and the test file is re-executed and at least one test fails, THEN the detector SHALL record the mutant as `"killed"` and SHALL NOT emit a finding for it.

3.4. WHILE running the SURVIVED detector, the tool SHALL restore the original source file content after each probe regardless of whether the probe passed or errored, before proceeding to the next mutation.

3.5. WHEN the SURVIVED detector cannot parse a source file due to a syntax error, it SHALL emit a diagnostic warning to stderr and skip that file without aborting the overall run.

3.6. WHERE a source symbol is annotated with `// canfail-no-mutate`, THEN the SURVIVED detector SHALL skip all mutations targeting that symbol.

---

**User Story 4:** As a security reviewer, I want the MOCK detector to identify mock, demo, or fixture identifiers that are reachable from a production entry point via the import graph, so that I can prevent test-only data from being silently included in production builds.

**Acceptance Criteria:**

4.1. WHEN the import graph is traversed from a configured production entry point and a module is reachable that exports or declares an identifier matching the pattern `MOCK_*`, `DEMO_*`, `FAKE_*`, or `FIXTURE_*` (case-insensitive prefix), THEN the MOCK detector SHALL emit a finding with `kind: "MOCK"` and the full import chain from the entry point to the offending module.

4.2. WHEN a file is located under a directory named `__tests__`, `test`, `tests`, `spec`, or `__mocks__` and is reachable only from other test files, THEN the MOCK detector SHALL NOT emit a finding for identifiers in that file.

4.3. WHEN a hardcoded string literal matching a sample-data pattern (e.g. `"john.doe@example.com"`, `"0.0.0.0"`, `"localhost"`, UUID-shaped literals, credit-card-shaped digit sequences) is found in a production-reachable module, THEN the MOCK detector SHALL emit a finding with `kind: "MOCK"` and subtype `"hardcoded-sample"`.

4.4. IF the entry point configuration is omitted, THEN the MOCK detector SHALL infer the entry point from the `main` or `exports` field of `package.json` and SHALL warn if neither field is present.

---

**User Story 5:** As an operations engineer, I want the SILENT detector to flag error handlers that return success unconditionally, so that I can identify code paths where failures are swallowed and the caller believes the operation succeeded.

**Acceptance Criteria:**

5.1. WHEN a `catch` block or error-handler function returns an HTTP status code of `200` or a response object with `{ ok: true }` or `{ status: "ok" }` unconditionally, THEN the SILENT detector SHALL emit a finding with `kind: "SILENT"` and subtype `"success-on-error"`.

5.2. WHEN a health-check route handler (identified by path patterns `/health`, `/healthz`, `/ping`, `/ready`, `/live`) returns a `200` response inside a `catch` block, THEN the SILENT detector SHALL emit a finding with `kind: "SILENT"` and subtype `"health-check-swallow"`.

5.3. WHEN an HTTP response is emitted with an empty or null body and a `2xx` status code from within a `catch` block, THEN the SILENT detector SHALL emit a finding with `kind: "SILENT"` and subtype `"empty-success"`.

5.4. WHILE scanning for SILENT patterns, the detector SHALL only flag handlers where the success response is issued unconditionally (not conditionally based on the error type), so that intentional fallback patterns are not falsely reported.

---

**User Story 6:** As a developer consuming `canfail` output in automated tooling, I want a `--json` flag that emits all findings as a structured JSON array, so that I can pipe the output into dashboards, diff tools, or custom reporters without parsing human text.

**Acceptance Criteria:**

6.1. WHEN `canfail` is run with the `--json` flag, THEN it SHALL write a single JSON object to stdout conforming to the `CanfailReport` schema with fields `version`, `timestamp`, `summary`, and `findings`.

6.2. WHEN `--json` is active and zero findings are produced, THEN the `findings` array SHALL be empty and `summary.total` SHALL be `0`, and the exit code SHALL still be `0`.

6.3. WHEN `--json` is active, THEN no human-readable table or progress output SHALL appear on stdout; all diagnostic messages SHALL go to stderr only.

6.4. WHERE a finding has a `chain` field (import path for MOCK findings), THEN the JSON output SHALL include it as an array of strings representing the import chain in order from entry point to offending module.

---

**User Story 7:** As a maintainer of `canfail` itself, I want a `fixtures/greenwashed-app` directory containing planted defects of each detector type, so that I can run `canfail` against its own fixture and verify the tool correctly identifies every planted issue before releasing a new version.

**Acceptance Criteria:**

7.1. WHEN `canfail` is run against `fixtures/greenwashed-app` using `canfail verify-fixtures`, THEN it SHALL assert that exactly the planted finding IDs are detected and SHALL exit with code `0` if and only if all planted findings are present in the output.

7.2. WHEN `canfail verify-fixtures` is run and one or more planted findings are missing from the output, THEN it SHALL list the missing finding IDs and exit with code `1`.

7.3. WHEN `canfail verify-fixtures` is run and findings are emitted for locations that are NOT in the planted-defects manifest, THEN it SHALL list these as unexpected findings and exit with code `1`.

7.4. IF `fixtures/greenwashed-app` contains at least one planted defect for each of the four detector kinds (VACUOUS, SURVIVED, MOCK, SILENT), THEN `canfail verify-fixtures` SHALL validate all four kinds in a single run.
