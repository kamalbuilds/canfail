# Requirements: UNEARNED Test Detection (`canfail prove`)

## Provenance

This spec was written **after** the implementation, during a prior-art review on 2026-08-23 that found no existing tool enforcing this invariant. Unlike `.kiro/specs/vacuity-detection`, this feature was not spec-first, and that is recorded rather than hidden. The purpose of this document is to make the already-implemented behaviour auditable, traceable, and maintainable — not to describe future work.

---

## Overview

`canfail prove` enforces an invariant that no CI system checks by default: every new test added in a branch must have been capable of failing on the base commit. A test that passes both before and after the fix it ships with does not constrain the behaviour it claims to cover; it documents the implementation instead of pinning it. This feature detects those tests and reports them as `UNEARNED` findings.

---

## User Stories

---

### User Story 1: Detecting changed tests that never could have caught the change

**User Story:** As a tech lead reviewing an AI-assisted PR, I want `canfail prove` to identify new or modified test files that pass even when the source they cover is reverted to the base commit, so that I can reject tests that document the implementation rather than constrain it.

**Acceptance Criteria:**

1.1 WHEN `canfail prove` is run against a git repository with a resolvable base ref AND the working tree contains at least one changed test file AND at least one source file in that test's import closure has also changed, THEN the system SHALL revert those changed source files to their base revision and run the test against that reverted code.

1.2 WHEN the test run against the reverted source exits with code `0` (green), THEN the system SHALL emit one `UNEARNED` finding for that test file with a message stating that the test passes against the base revision and would not have failed before the change.

1.3 WHEN the test run against the reverted source exits with a non-zero code (red), THEN the system SHALL record that test file in the `earned` list and SHALL NOT emit an `UNEARNED` finding for it.

1.4 WHEN `canfail prove` completes with at least one unsuppressed `UNEARNED` finding, THEN the system SHALL exit with code `1`.

1.5 WHEN `canfail prove` completes with zero unsuppressed `UNEARNED` findings, THEN the system SHALL exit with code `0`.

---

### User Story 2: Unconditional working-tree restoration

**User Story:** As a developer running `canfail prove` locally, I want all source files reverted during the check to be restored byte-for-byte to their working-tree state regardless of how the run ends, so that an interrupted or failing prove run never leaves my working tree in a mutated state.

**Acceptance Criteria:**

2.1 WHEN the test run completes (whether green, red, or timed-out), THEN the system SHALL restore every source file it reverted to the exact byte-for-byte content it held before the revert, before moving to the next test file.

2.2 WHEN `canfail prove` encounters an unhandled exception during a test run, THEN the system SHALL still restore all reverted files via the `finally` block before re-throwing.

2.3 WHEN restoration is complete, THEN the system SHALL call `RevertGuard.verifyClean()` to assert that no `.canfail-hidden` files remain; IF a hidden file is still present after restoration, THEN the system SHALL throw an error with exit code `2` instructing the user to look for stray `*.canfail-hidden` files.

2.4 WHILE a source file is reverted, THEN no other mutation or revert operation SHALL be applied to that file by the same guard instance.

---

### User Story 3: Handling source files that did not exist at the base revision

**User Story:** As a developer who has added a brand-new source module in this branch, I want `canfail prove` to handle that file safely even though it has no base revision content, so that the prove run neither deletes my new file nor silently skips checking tests that import it.

**Acceptance Criteria:**

3.1 WHEN a source file in a test's import closure exists in the working tree AND `git show base:path` returns non-zero for that file (the file did not exist at the base revision), THEN the system SHALL move the file aside by renaming it with a `.canfail-hidden` suffix rather than deleting it.

3.2 WHEN a source file has been moved aside as `.canfail-hidden`, THEN on restoration the system SHALL rename it back to its original path.

3.3 WHEN a source file has been moved aside and the test run executes, THEN the test will fail (because its import is absent), and that test SHALL be recorded as `earned`.

3.4 WHERE a `.canfail-hidden` file still exists after `restoreAll()` is called, THEN `verifyClean()` SHALL return `false`, causing the system to abort with exit code `2`.

---

### User Story 4: Skipping tests whose import closure has no changed source

**User Story:** As a developer who has added a test for an unchanged module, I want `canfail prove` to skip that test rather than failing it, so that I am not penalised for adding tests to code that was not modified in this branch.

**Acceptance Criteria:**

4.1 WHEN a changed test file's complete import closure (all transitively reachable first-party source files) contains no file that also appears in the changed-files list, THEN the system SHALL skip that test file without running it.

4.2 WHEN a test file is skipped under criterion 4.1, THEN the system SHALL record it in the `skipped` list with the reason: `"no changed source in this test's import closure, so there is nothing for it to have proved"`.

4.3 WHEN a test file is skipped under criterion 4.1, THEN the system SHALL NOT emit an `UNEARNED` finding for it, and it SHALL NOT count toward exit code `1`.

4.4 IF a test file's import closure includes at least one changed source file, THEN the test SHALL NOT be skipped regardless of how many other source files in its closure are unchanged.

---

### User Story 5: Refusing to run outside a git repository or with an unresolvable base ref

**User Story:** As a CI pipeline operator, I want `canfail prove` to fail immediately and clearly when the preconditions for the check are not met — either the directory is not a git repository, or the supplied base ref does not resolve — so that the gate never silently passes due to an environment misconfiguration.

**Acceptance Criteria:**

5.1 WHEN `canfail prove` is invoked in a directory that is not inside a git work tree (i.e., `git rev-parse --is-inside-work-tree` does not return `"true"`), THEN the system SHALL throw an error with the message `"<path> is not a git repository; canfail prove needs history"` and SHALL exit with code `2`.

5.2 WHEN `canfail prove` is invoked with a `--base` value that cannot be resolved to a commit SHA (i.e., `git rev-parse --verify <ref>^{commit}` fails), THEN the system SHALL throw an error with the message `"cannot resolve base revision \"<ref>\""` and SHALL exit with code `2`.

5.3 WHEN neither criterion 5.1 nor 5.2 applies and no changed test files exist between the base and the working tree, THEN the system SHALL return an empty result set and exit with code `0` without performing any file reversions.

5.4 WHERE the `--base` option is not supplied, THEN the system SHALL default to `HEAD~1` as the base revision.

5.5 IF the resolved base SHA differs from the ref string supplied by the user (e.g., the user supplied a branch name), THEN the system SHALL record and use the resolved SHA when constructing finding IDs and messages, not the human-readable ref.

---

## Terminology

| Term | Definition |
|------|-----------|
| **base revision** | The git commit against which the working tree is compared; defaults to `HEAD~1`. |
| **changed file** | A file reported by `git diff --name-only <base>` or `git ls-files --others --exclude-standard`. |
| **import closure** | The set of all first-party source files transitively reachable from a test file via its import graph. |
| **UNEARNED** | A finding kind indicating a test that passes against the base revision of the source it covers. |
| **earned** | A changed test that correctly fails against the reverted source — the desired state. |
| **skipped** | A changed test excluded from checking because its import closure contains no changed source. |
| **RevertGuard** | The internal class responsible for reverting files and restoring them unconditionally. |
| `.canfail-hidden` | The suffix appended to files that did not exist at the base revision when they are moved aside. |
