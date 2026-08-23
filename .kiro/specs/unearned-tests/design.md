# Design: UNEARNED Test Detection (`canfail prove`)

## 1. Overview

`canfail prove` is a git-aware CI gate implemented in `src/prove.ts` and surfaced via the `prove` subcommand in `bin/canfail.ts`. It answers the question: "Would this test have failed on the code that existed before this change?" If the answer is no, the test is `UNEARNED`.

The feature reuses the existing `runTestFile` bridge from the mutation engine and the `buildImportGraph` / `reachableFrom` utilities from the graph module, adding only the git plumbing and the `RevertGuard` lifecycle on top.

---

## 2. Architecture

```
bin/canfail.ts  (CLI parsing, exit codes)
       │
       ▼
src/prove.ts
 ├─ isGitRepo()          git rev-parse --is-inside-work-tree
 ├─ resolveRef()         git rev-parse --verify <ref>^{commit}
 ├─ changedFiles()       git diff --name-only + git ls-files --others
 ├─ fileAtRef()          git show <ref>:<rel-path>
 ├─ RevertGuard          revert / restore / verifyClean lifecycle
 └─ prove()              main orchestration function
       │
       ├─ src/ast/index.ts         isTestFile()
       ├─ src/graph/importer.ts    buildImportGraph(), listSourceFiles(), reachableFrom()
       └─ src/mutation/runner.ts   runTestFile()
```

### Module responsibilities

| Module | Role |
|--------|------|
| `src/prove.ts` | Git plumbing, RevertGuard, top-level `prove()` orchestration |
| `src/ast/index.ts` | `isTestFile()` — identifies `.test.ts/js` files by naming convention |
| `src/graph/importer.ts` | Import graph construction; `reachableFrom()` computes the transitive closure of imports from a test file |
| `src/mutation/runner.ts` | `runTestFile()` — spawns the configured test command for a single file and returns `{outcome: "green" | "red" | "timeout"}` |
| `bin/canfail.ts` | Parses `--base`, `--test-command`, `--timeout`, `--json`, `-q`; formats output; maps thrown errors to exit code 2 |

---

## 3. Data Types

```typescript
// Input
interface ProveOptions extends Omit<RunnerOptions, "cwd"> {
  root: string;           // absolute path to repo root
  base: string;           // ref string (e.g. "HEAD~1", branch name, SHA)
  onProgress?: (msg: string) => void;
}

// Output
interface ProveOutcome {
  findings: Finding[];                          // UNEARNED findings (suppressed flag set per file)
  earned: string[];                             // relative paths of tests that correctly went red
  skipped: { file: string; reason: string }[];  // tests excluded from checking
  base: string;                                 // resolved SHA of the base commit
}

// Finding (from src/types.ts)
interface Finding {
  id: string;         // findingId("UNEARNED", file, 1, base)
  kind: "UNEARNED";
  location: { file: string; line: 1; column: 1 };
  message: string;    // human-readable, names the reverted files
  suppressed: boolean; // true if line 1 of the test contains "canfail-ignore"
}
```

---

## 4. RevertGuard Lifecycle

`RevertGuard` is a small stateful class whose single invariant is: every file it touches is restored before `prove()` returns, even if a test run throws or times out.

```
RevertGuard instance created
       │
       ▼
for each source file to revert:
  ┌─ fileAtRef() returns content?
  │   YES → snapshot current content; overwrite file with base content
  │          restored map: file → original content
  │   NO  → rename file to file + ".canfail-hidden"
  │          hidden list: [ file ]
       │
       ▼
  runTestFile()  ← test executes against reverted sources
       │
       ▼
  (finally) restoreAll()
    ├─ for each (file, originalContent) in restored map:
    │     writeFileSync(file, originalContent)
    └─ for each file in hidden list:
          if existsSync(file + ".canfail-hidden"):
              renameSync(file + ".canfail-hidden", file)
       │
       ▼
  (outer finally) guard.restoreAll() called again (idempotent safety net)
       │
       ▼
  guard.verifyClean()
    └─ for each file in hidden list:
          if existsSync(file + ".canfail-hidden") → return false
    if false → throw Error (exit code 2)
```

**Why rename instead of delete?** Deletion is irreversible. If the process is killed between the revert and the restore, a renamed file is recoverable; a deleted one is not. The `.canfail-hidden` suffix makes stray files immediately visible and searchable.

**Why two `restoreAll()` calls?** The inner `try/finally` inside the `for` loop over test files restores after each individual test run. The outer `try/finally` around the entire loop is a belt-and-suspenders guard in case an exception escapes the inner block. `restoreAll()` clears its internal maps on each call, so double-invocation is safe.

---

## 5. Git Plumbing

### 5.1 `isGitRepo(root)`

```
git rev-parse --is-inside-work-tree
```
Returns `true` if the command exits 0 and stdout is `"true"`. Used as the first guard in `prove()`.

### 5.2 `resolveRef(root, ref)`

```
git rev-parse --verify <ref>^{commit}
```
Resolves any ref type (branch, tag, `HEAD~N`, abbreviated SHA, full SHA) to a canonical 40-character commit SHA. Returns `undefined` on failure. The `^{commit}` peel ensures tag objects are dereferenced to their commit.

### 5.3 `changedFiles(root, base)`

Two commands run independently and their results are merged:

```
git diff --name-only <base> --
```
Reports all tracked files that differ between `base` and the current working tree (including staged and unstaged changes).

```
git ls-files --others --exclude-standard
```
Reports untracked files not covered by `.gitignore`. This catches brand-new files that are not yet staged.

Both outputs are split on newlines, trimmed, filtered for empty strings, de-duplicated with `Set`, resolved to absolute paths, and filtered to only those paths that `existsSync()`. The `existsSync` filter ensures that files deleted from the working tree (present in the diff but absent on disk) are excluded — they are not actionable.

### 5.4 `fileAtRef(root, ref, absPath)`

```
git show <ref>:<relative-path>
```
Returns the file content as a string if the command exits 0 (file existed at that revision), or `undefined` if the command fails (file did not exist at that revision, or `ref` does not exist). The relative path is computed with `node:path`'s `relative(root, absPath)`.

---

## 6. Step-by-Step Algorithm

```
prove(opts):
  1. isGitRepo(root) — throw if false (exit 2)
  2. resolveRef(root, base) → baseSha — throw if undefined (exit 2)
  3. changedFiles(root, base) → changed[]
  4. changedTests  = changed.filter(isTestFile)
  5. changedSources = changed.filter(not isTestFile)
  6. if changedTests.length === 0: return empty outcome (exit 0)
  7. buildImportGraph(root, listSourceFiles(root)) → graph
  8. new RevertGuard() → guard
  9. try:
       for each testFile in changedTests:
         a. reachableFrom(graph, testFile) → closure (Set<string>)
         b. toRevert = changedSources.filter(s => closure.has(s))
         c. if toRevert.length === 0:
              skipped.push({ file: rel, reason: "no changed source..." })
              continue
         d. onProgress?.(message with count and base ref)
         e. try:
              for each src in toRevert:
                guard.revertTo(src, fileAtRef(root, baseSha, src))
              outcome = runTestFile(testFile, { ...opts, cwd: root })
            finally:
              guard.restoreAll()
         f. if outcome.outcome === "green":
              findings.push(UNEARNED finding with suppressed flag)
            else if outcome.outcome === "timeout":
              skipped.push({ file: rel, reason: "test run timed out..." })
            else:
              earned.push(rel)
     finally:
       guard.restoreAll()             // idempotent safety net
       if !guard.verifyClean():
         throw Error("stray *.canfail-hidden files") // exit 2
  10. return { findings, earned, skipped, base: baseSha }
```

---

## 7. Suppression

A test file whose first line contains the string `canfail-ignore` has its `UNEARNED` finding marked `suppressed: true`. Suppressed findings are included in the JSON output but excluded from the unsuppressed count used for exit code determination and from the human-readable table output.

Suppression is checked after the test run completes (not before), so the test is still executed against the base revision. Suppression records an intentional exception, not a skip.

---

## 8. CLI Interface (`bin/canfail.ts`)

```
canfail prove [path]
  [path]                  git repository root (default: ".")
  --base <ref>            revision the tests must fail against (default: "HEAD~1")
  --test-command <cmd>    command that runs one test file (default: "npx vitest run")
  --timeout <ms>          per-test-run timeout in milliseconds (default: 60000)
  --json                  emit the ProveOutcome as JSON on stdout
  -q, --quiet             suppress progress output on stderr
```

No `--no-mutate`, `--max-mutants`, `--only`, `--exclude`, or `--max-findings` flags exist on `prove`; those belong to `scan`. The `prove` subcommand is a separate gate with a separate concern.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All changed tests are earned (or skipped), no unsuppressed UNEARNED findings |
| `1` | At least one unsuppressed UNEARNED finding |
| `2` | `canfail prove` could not run: not a git repo, unresolvable ref, or working-tree restoration failed |

### Human-readable output format

```
  EARNED   src/discount.test.ts
           failed against HEAD~1, as a new test should

  UNEARNED src/other.test.ts
           passes against HEAD~1 with src/other.ts reverted: this test would not have failed before the change

  skipped  src/unrelated.test.ts
           no changed source in this test's import closure, so there is nothing for it to have proved

  1 changed test(s), every one of them failed before the change
```

---

## 9. Error-Handling Table

| Condition | Detection point | Behaviour | Exit code |
|-----------|----------------|-----------|-----------|
| Path is not a git repo | `isGitRepo()` at start of `prove()` | Throws `Error("<path> is not a git repository; canfail prove needs history")` | 2 |
| Base ref does not resolve | `resolveRef()` at start of `prove()` | Throws `Error("cannot resolve base revision \"<ref>\"")` | 2 |
| `git diff` or `git ls-files` fails | `changedFiles()` | Returns empty array for the failing command; partial results used | — (graceful degradation) |
| `git show ref:path` fails | `fileAtRef()` | Returns `undefined`; file is moved aside with `.canfail-hidden` suffix | — |
| Test run times out | `runTestFile()` returns `"timeout"` | Recorded as skipped with reason | 0 (not an error) |
| Test run crashes (non-zero exit) | `runTestFile()` returns `"red"` | Recorded as earned | 0 |
| File restoration fails (stray hidden) | `verifyClean()` after outer finally | Throws `Error("canfail could not restore a reverted file…")` | 2 |
| Unhandled exception in prove loop | Outer try/finally | `guard.restoreAll()` called; error propagated to CLI; stderr message written | 2 |
| `--base` not supplied | Commander default | Uses `"HEAD~1"` | — |

---

## 10. Non-Goals

The following are explicitly out of scope for `canfail prove`:

- **Exhaustive mutation testing.** `prove` does not generate mutants. It reverts real git history. `canfail scan --mutate` is the mutation gate.
- **Full test suite runs.** `prove` runs one test file at a time, as `scan` does. It does not run the full suite.
- **Staged-only changes.** `prove` considers all differences between the base and the working tree, including unstaged and untracked files. It does not have a `--staged` mode.
- **Non-first-party imports.** The import graph follows relative imports only. `node_modules` and `tsconfig` path aliases are not resolved. A mock reachable only through a path alias will not be detected.
- **Multi-base comparisons.** `prove` takes exactly one `--base` ref. Comparing against multiple ancestors is not supported.
- **Fixing the tests.** `prove` reports. It does not rewrite or delete tests. Remediation is the developer's responsibility.
- **TypeScript path alias resolution.** The underlying `importer.ts` module does not resolve bare specifiers or `paths` entries from `tsconfig.json`.
