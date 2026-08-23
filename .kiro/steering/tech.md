# Tech: canfail

## Runtime and Language

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20 or later (uses `node:crypto`, `node:fs`, `node:child_process`)
- **Module format**: ESM (`"type": "module"` in `package.json`)
- **Target**: `ES2022` in `tsconfig.json`, `module: NodeNext`, `moduleResolution: NodeNext`

## Build

The project compiles with `tsc -p tsconfig.json`. Output goes to `dist/`. There is no bundler. The `bin.canfail` entry in `package.json` points to `dist/bin/canfail.js`.

`npm run build` runs `tsc` directly. `pretest` calls `build` so the test suite always runs against compiled output.

## Core Dependencies

| Package | Purpose |
|---|---|
| `ts-morph` | AST parsing, traversal, and in-memory source manipulation for all static detectors |
| `commander` | CLI argument parsing - subcommands, flags, help text |

Dev-only:

| Package | Purpose |
|---|---|
| `typescript` | Compiler (`tsc`) |
| `vitest` | Test runner for unit and integration tests |
| `@types/node` | Node.js type definitions |

No other dependencies. No bundler. No HTTP client. No runtime beyond what ships with Node.

## Subprocess Execution

All subprocess spawning uses `node:child_process` `spawnSync`. The mutation probe and the `prove` command both shell out to run the user's test command (e.g. `npx vitest run`, `go test ./{dir}`) and read the exit code. No async process orchestration or third-party process libraries.

## Hard Constraints

**No network calls.** `canfail` must work fully offline. No telemetry, no remote APIs, no package registry queries, no CDN fetches. Any code that opens a socket is a bug.

**No paid APIs.** No OpenAI, no Anthropic, no cloud LLM calls of any kind. All analysis is local static analysis and local subprocess execution.

**No code generation that runs untrusted code.** Mutations are applied as text edits to the user's own source files. The mutation engine writes to disk, runs the user's own configured test command, and restores the original. It never executes generated code in a `vm` context or `eval`.

**No global side effects.** `canfail` does not install hooks, does not modify `node_modules`, does not write files outside the project directory except for two crash-safety artifacts (`.canfail-journal.json` and `.canfail-backup/`) which live at the scanned project root and are cleaned up after a successful run.

## Crash Journal and Backup

`.canfail-journal.json` and `.canfail-backup/` are written at the project root of the directory being scanned (not canfail's own root). They record the original bytes of any file about to be mutated. On the next run, `recoverFromJournal()` in `src/mutation/journal.ts` reads the journal and restores any dirty files before scanning begins. The journal is deleted only after `verifyClean()` confirms the tree is byte-identical to its pre-probe state.

## TypeScript Practices

- All public module exports have explicit return types
- All file paths are stored as absolute paths internally; relative paths are only used for display output
- Async functions use `async/await`; no raw Promise chains
- Errors are typed; no `throw "string"` - always `throw new Error(...)`

## Test Tooling

- **Framework**: vitest
- **Test files**: colocated with source (`src/foo.test.ts` next to `src/foo.ts`)
- **Integration tests**: `tests/integration/` directory, invoke CLI as a subprocess via `spawnSync`
- **No mocking of the filesystem in unit tests** - use ts-morph in-memory source files instead
- **Mutation engine tests** may stub the `runner.ts` module to avoid spawning real subprocesses

## CI Pipeline

CI runs on GitHub Actions (`.github/workflows/ci.yml`), ubuntu-latest, Node 20. Steps in order:

1. `npm install`
2. `npm run build` (tsc)
3. `no-mutants-committed.sh` - rejects committed mutation artifacts
4. `npx vitest run` - unit and integration tests
5. `canfail verify-fixtures` - asserts every planted defect in greenwashed-app is caught
6. `canfail scan fixtures/clean-app` - asserts a well-tested module produces zero findings
7. `prove-gate-can-fail.sh` - breaks a detector, asserts the gate goes red, restores it
8. `demo-prove.sh` - end-to-end prove on a throwaway TypeScript git repo
9. `demo-prove-go.sh` - end-to-end prove on a real Go module
10. `canfail scan . --exclude fixtures --no-mutate` - self-hosting gate
