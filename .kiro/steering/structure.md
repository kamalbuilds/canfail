# Structure: canfail

## Directory Layout

```
canfail/
├── bin/
│   └── canfail.ts              # CLI entry point (commander setup, exit codes, scan/prove/verify-fixtures subcommands)
│
├── src/
│   ├── orchestrator.ts         # Sequences detectors, merges findings, returns CanfailReport
│   ├── types.ts                # Finding, Location, MutantDescriptor, CanfailReport, Summary interfaces
│   ├── prove.ts                # UNEARNED detector: reverts source to base revision, reruns changed tests, requires red
│   ├── lang.ts                 # Language detection for prove: recognises TS, JS, Go, Python, Rust, Ruby, Java test files
│   ├── verify-fixtures.ts      # canfail verify-fixtures subcommand implementation
│   │
│   ├── ast/
│   │   └── index.ts            # ts-morph wrappers: parseFile, parseInMemory, isTestFile, helper finders
│   │
│   ├── detectors/
│   │   ├── vacuous.ts          # VACUOUS detector (no-assertion, tautological, empty-catch, skipped, snapshot-only, unreachable)
│   │   ├── vacuous.test.ts
│   │   ├── mock.ts             # MOCK detector (identifier pattern, hardcoded sample data, import-chain reachability)
│   │   ├── silent.ts           # SILENT detector (success-on-error, health-check-swallow, empty-success)
│   │   └── silent.test.ts
│   │
│   ├── graph/
│   │   ├── importer.ts         # Import graph builder (directed, file-based resolution), listSourceFiles, reachableFrom
│   │   └── importer.test.ts
│   │
│   ├── mutation/
│   │   ├── engine.ts           # Probe loop: iterate test files, apply mutants, run, restore, collect survivors
│   │   ├── mutants.ts          # MutationTarget enumeration for four kinds: comparison-swap, boolean-flip, return-sentinel, conditional-negation
│   │   ├── mutants.test.ts
│   │   ├── restore.ts          # FileGuard (snapshot/write/restore/verifyClean) and guardProcess signal handlers
│   │   ├── restore.test.ts
│   │   ├── journal.ts          # Crash journal: on-disk backup of mutated files for SIGKILL recovery
│   │   ├── runner.ts           # Subprocess test runner bridge (spawnSync, exit code only)
│   │   └── runner.test.ts
│   │
│   └── report/
│       └── table.ts            # ASCII table renderer with colour support
│
├── tests/
│   └── integration/
│       ├── cli.test.ts         # Smoke tests: --help, --json, exit codes, scan and verify-fixtures
│       ├── prove.test.ts       # End-to-end: canfail prove against a throwaway TypeScript git repo
│       ├── prove-go.test.ts    # End-to-end: canfail prove against a real Go module
│       └── crash-recovery.test.ts  # SIGKILLs a real probe, asserts the next run restores via the journal
│
├── fixtures/
│   ├── greenwashed-app/        # Planted defects, one per detector subtype
│   │   ├── package.json
│   │   ├── vitest.config.ts
│   │   ├── canfail-manifest.json  # Planted finding IDs and expected locations
│   │   └── src/
│   │       ├── index.ts        # Production entry point
│   │       ├── scoring.ts      # Source with a survivable mutation target (boundary comparison)
│   │       ├── scoring.test.ts # Test that does not kill a threshold inversion
│   │       ├── api.ts          # Source module
│   │       ├── api.test.ts     # Test with vacuous assertions
│   │       ├── health.ts       # Catch block returning ok:true (SILENT defect)
│   │       ├── db.ts           # Database helper
│   │       └── ui/
│   │           └── ResultScreen.ts  # Mock data reachable from entry point (MOCK defect)
│   │
│   └── clean-app/              # A correct test suite, zero findings expected
│       ├── package.json
│       ├── vitest.config.ts
│       └── src/
│           ├── pricing.ts
│           └── pricing.test.ts
│
├── scripts/
│   ├── no-mutants-committed.sh    # CI guard: rejects committed mutation sentinels
│   ├── prove-gate-can-fail.sh     # Breaks a detector, asserts the gate goes red, restores it
│   ├── demo-prove.sh             # End-to-end prove demo with a throwaway TypeScript repo
│   ├── demo-prove-go.sh          # End-to-end prove demo with a Go module
│   ├── demo-prove-kirocrew.sh    # Python prove demo using behavior adapted from pinned KiroCrew source
│   ├── demo-run.sh               # Full ten-beat narrated terminal track
│   ├── shots.sh                  # Terminal screenshot generation with freeze
│   └── _shot.sh                  # Helper for shots.sh
│
├── .github/workflows/ci.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Naming Conventions

- Source files: `camelCase.ts`
- Test files: colocated, `camelCase.test.ts`
- All exported types: `PascalCase`
- All exported functions: `camelCase`
- Mutation kind enum values: `kebab-case` strings (`"comparison-swap"`, `"boolean-flip"`)
- Finding kind values: `SCREAMING_SNAKE_CASE` strings (`"VACUOUS"`, `"SURVIVED"`, `"MOCK"`, `"SILENT"`, `"UNEARNED"`)

## Colocation Rule

Unit tests are colocated with the source modules they exercise where practical. Cross-module behavior and modules whose contract is the assembled CLI (`prove.ts`, `orchestrator.ts`, and crash recovery) are exercised by subprocess integration tests under `tests/integration/`.

## Fixture Rule

`fixtures/greenwashed-app/canfail-manifest.json` is the single source of truth for what `canfail verify-fixtures` expects to find. Any change to a planted defect requires a corresponding update to the manifest. The clean fixture (`fixtures/clean-app`) must produce zero findings and is verified in CI on every push.

## Import Boundaries

- `bin/canfail.ts` imports from `src/orchestrator.ts`, `src/prove.ts`, `src/verify-fixtures.ts`, `src/types.ts`, and `src/report/table.ts`.
- Detectors (`src/detectors/`) import from `src/ast/` and `src/types.ts` only. The MOCK detector additionally imports from `src/graph/importer.ts` for reachability analysis.
- The mutation engine (`src/mutation/`) imports from `src/ast/`, `src/graph/`, `src/types.ts`, and its own siblings.
- `src/prove.ts` imports from `src/graph/importer.ts`, `src/lang.ts`, `src/mutation/runner.ts`, and `src/types.ts`.
- The orchestrator (`src/orchestrator.ts`) is the integration point that imports from detectors, mutation engine, graph, journal, runner, and types.
