# Tech: canfail

## Runtime and Language

- **Language**: TypeScript (strict mode, no `any`)
- **Runtime**: Node.js 20 or later (uses `node:crypto`, `node:fs/promises`, `node:child_process`)
- **Module format**: ESM (`"type": "module"` in `package.json`)
- **Target**: `ESNext` in `tsconfig.json`, `moduleResolution: bundler`

## Core Dependencies

| Package | Purpose |
|---|---|
| `ts-morph` | AST parsing, traversal, and in-memory source manipulation for all four detectors |
| `commander` | CLI argument parsing — subcommands, flags, help text |
| `vitest` | Test runner for unit and integration tests |
| `execa` | Spawn subprocess for test runner bridge and CLI smoke tests |

No other runtime dependencies. No framework. No ORM. No HTTP client.

## Hard Constraints

**No network calls.** `canfail` must work fully offline. No telemetry, no remote APIs, no package registry queries, no CDN fetches. Any code that opens a socket is a bug.

**No paid APIs.** No OpenAI, no Anthropic, no cloud LLM calls of any kind. All analysis is local static analysis and local subprocess execution.

**No code generation that runs untrusted code.** Mutations are applied as text edits to the user's own source files. The mutation engine writes to disk, runs the user's own configured test command, and restores the original. It never executes generated code in a `vm` context or `eval`.

**No global side effects.** `canfail` does not install hooks, does not modify `node_modules`, does not write any file outside the project directory (except for temp files in the OS temp directory during mutation probes, which are cleaned up immediately).

## TypeScript Practices

- All public module exports must have explicit return types
- `as` type assertions are forbidden in `src/`; use type guards instead
- All file paths are stored as absolute paths internally; relative paths are only used for display output
- Async functions use `async/await`; no raw Promise chains
- Errors are typed; no `throw "string"` — always `throw new Error(...)`

## Test Tooling

- **Framework**: vitest
- **Test files**: colocated with source (`src/foo.test.ts` next to `src/foo.ts`)
- **Integration tests**: `tests/integration/` directory, invoke CLI as a subprocess via `execa`
- **Fixture tests**: `tests/fixtures.test.ts` validates the planted-defects manifest is structurally correct
- **No mocking of the filesystem in unit tests** — use ts-morph in-memory source files instead
- **Mutation engine tests** may stub the `runner.ts` module to avoid spawning real subprocesses

## Build and Release

- `tsup` for bundling (zero-config, ESM output)
- `package.json` `bin.canfail` points to the compiled entry
- CI runs: `tsc --noEmit`, `vitest run`, `canfail src/` (self-hosting gate)
- No minification (this is a dev tool; readable output on errors is more valuable than size)
