# Tasks: UNEARNED Test Detection (`canfail prove`)

> All tasks are marked complete. This feature was implemented before this spec was written.
> Requirement references use the numbering in `requirements.md`.

---

- [x] 1. **Implement `isGitRepo(root)`** — run `git rev-parse --is-inside-work-tree` via `spawnSync` and return `true` iff stdout is `"true"`. Used as the first precondition guard in `prove()`.
  _Requirements: 5.1_

- [x] 2. **Implement `resolveRef(root, ref)`** — run `git rev-parse --verify <ref>^{commit}` and return the trimmed stdout on success, or `undefined` on failure. The `^{commit}` peel handles tag objects and branch names uniformly.
  _Requirements: 5.2, 5.5_

- [x] 3. **Implement `changedFiles(root, base)`** — combine `git diff --name-only <base> --` (tracked changes) and `git ls-files --others --exclude-standard` (untracked new files), deduplicate via `Set`, resolve to absolute paths, and filter with `existsSync` to exclude deleted files.
  _Requirements: 1.1, 3.1_

- [x] 4. **Implement `fileAtRef(root, ref, absPath)`** — run `git show <ref>:<relative-path>` and return the stdout string on success, or `undefined` when the file did not exist at that revision.
  _Requirements: 3.1, 3.2_

- [x] 5. **Implement `RevertGuard.revertTo(file, baseContent)`** — when `baseContent` is defined, snapshot the current file content and overwrite with base content; when `baseContent` is `undefined`, rename the file to `file + ".canfail-hidden"` and record the original path in the hidden list.
  _Requirements: 2.1, 3.1, 3.2_

- [x] 6. **Implement `RevertGuard.restoreAll()`** — write every snapshotted file back to its original content; rename every `.canfail-hidden` file back to its original path (only if the hidden file still exists); clear both internal maps so the method is idempotent.
  _Requirements: 2.1, 2.2, 3.2_

- [x] 7. **Implement `RevertGuard.verifyClean()`** — iterate the hidden list and return `false` if any `file + ".canfail-hidden"` path still exists on disk; return `true` otherwise. Called after the outer finally block to catch incomplete restoration.
  _Requirements: 2.3, 3.4_

- [x] 8. **Implement the per-test-file loop in `prove()`** — for each changed test file: compute the import closure via `reachableFrom()`; intersect with `changedSources` to produce `toRevert`; skip with a reason message if `toRevert` is empty; otherwise revert, run, and restore inside an inner `try/finally`.
  _Requirements: 1.1, 4.1, 4.2, 4.3, 4.4_

- [x] 9. **Classify the test run outcome** — after restoration, inspect `runTestFile()` result: `"green"` → push an `UNEARNED` finding (with suppressed flag derived from `canfail-ignore` on line 1); `"timeout"` → push to `skipped`; anything else → push relative path to `earned`.
  _Requirements: 1.2, 1.3_

- [x] 10. **Implement suppression via `canfail-ignore`** — read the first line of the test file after the test run; set `suppressed: true` on the finding if it contains the literal string `canfail-ignore`. Suppressed findings are included in JSON output but excluded from exit-code-1 counting.
  _Requirements: 1.4, 1.5_

- [x] 11. **Wire the outer `try/finally` and `verifyClean` guard** — wrap the entire test-file loop in a `try/finally` that calls `guard.restoreAll()` as a belt-and-suspenders safety net, then calls `guard.verifyClean()` and throws with a diagnostic message if it returns `false`.
  _Requirements: 2.2, 2.3, 3.4_

- [x] 12. **Wire the `prove` subcommand in `bin/canfail.ts`** — register `canfail prove [path]` with Commander, parse `--base` (default `"HEAD~1"`), `--test-command` (default `"npx vitest run"`), `--timeout` (default `60000`), `--json`, and `-q/--quiet`; call `prove()`; format and write human-readable or JSON output; map thrown errors to exit code `2` and unsuppressed findings to exit code `1`.
  _Requirements: 1.4, 1.5, 5.1, 5.2, 5.4_

- [x] 13. **Write integration test: earned test (boundary case)**  — build a throwaway git repo with a boundary bug at base, apply the fix, write a test that targets the exact boundary, call `prove()`, assert `findings` is empty and `earned` contains the test file.
  _Requirements: 1.3_

- [x] 14. **Write integration test: UNEARNED test (trivially-passing case)** — same repo; write a test that asserts a value well away from the boundary (passes both before and after the fix), call `prove()`, assert one `UNEARNED` finding with `kind === "UNEARNED"` and message containing `"would not have failed before the change"`.
  _Requirements: 1.2_

- [x] 15. **Write integration test: working-tree restoration** — after a `prove()` run, read the source file from disk and assert it is byte-for-byte identical to the content before the call; also assert no `*.canfail-hidden` files exist in the directory.
  _Requirements: 2.1, 2.3_

- [x] 16. **Write integration test: brand-new source file** — add a new `.js` module (not present at base) and a test that imports it; call `prove()`; assert the new source file is present on disk after the run with its original content (not deleted), and the test appears in `earned`.
  _Requirements: 3.1, 3.2, 3.3_

- [x] 17. **Write integration test: skip test with no changed source in closure** — commit an unrelated module, then add only a test for it (no source change); call `prove()`; assert `findings` is empty and the test file appears in `skipped`.
  _Requirements: 4.1, 4.2, 4.3_

- [x] 18. **Write integration test: refuse to run outside a git repo** — create a plain temp directory (no `.git`); assert that `prove()` throws with `/not a git repository/`.
  _Requirements: 5.1_

- [x] 19. **Write integration test: refuse to run with an unresolvable base ref** — use a valid repo; assert that `prove()` throws with `/cannot resolve base revision/` when passed `"no-such-ref"`.
  _Requirements: 5.2_

- [x] 20. **Implement `cleanHidden(root)`** — a utility exported from `src/prove.ts` that scans source files for any path ending in `.canfail-hidden` and deletes them; used to recover from interrupted runs.
  _Requirements: 2.3, 3.4_
