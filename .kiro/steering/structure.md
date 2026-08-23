# Structure: canfail

## Directory Layout

```
canfail/
├── bin/
│   └── canfail.ts              # CLI entry point (commander setup, exit code logic)
│
├── src/
│   ├── config.ts               # CanfailConfig interface and loader
│   ├── orchestrator.ts         # Sequences detectors, merges findings, returns CanfailReport
│   ├── types.ts                # Finding, Location, MutantDescriptor, CanfailReport interfaces
│   │
│   ├── ast/
│   │   └── index.ts            # ts-morph wrappers: parseFile, parseInMemory, helper finders
│   │
│   ├── detectors/
│   │   ├── vacuous.ts          # VACUOUS detector (no-assertion, tautological, empty-catch, skipped, snapshot-only, unreachable)
│   │   ├── vacuous.test.ts
│   │   ├── mock.ts             # MOCK detector (identifier pattern, hardcoded sample data)
│   │   ├── mock.test.ts
│   │   ├── silent.ts           # SILENT detector (success-on-error, health-check-swallow, empty-success)
│   │   └── silent.test.ts
│   │
│   ├── graph/
│   │   ├── importer.ts         # Import graph builder (directed, ts-morph resolution)
│   │   └── importer.test.ts
│   │
│   ├── mutation/
│   │   ├── engine.ts           # Probe loop: iterate targets, apply, run, restore, collect survivors
│   │   ├── engine.test.ts
│   │   ├── mutants.ts          # MutationTarget enumeration for the four mutation kinds
│   │   ├── mutants.test.ts
│   │   ├── restore.ts          # Snapshot and atomic restore of file content
│   │   ├── restore.test.ts
│   │   ├── runner.ts           # Subprocess test runner bridge
│   │   └── runner.test.ts
│   │
│   ├── report/
│   │   ├── reporter.ts         # Routes to table or json formatter based on flags
│   │   ├── table.ts            # ASCII table renderer
│   │   ├── table.test.ts
│   │   ├── json.ts             # CanfailReport JSON serializer
│   │   └── json.test.ts
│   │
│   └── verify-fixtures.ts      # canfail verify-fixtures subcommand implementation
│
├── tests/
│   ├── integration/
│   │   ├── cli.test.ts         # Smoke tests: --help, --json, exit codes
│   │   └── verify-fixtures.test.ts  # End-to-end: canfail verify-fixtures against greenwashed-app
│   └── fixtures.test.ts        # Validates canfail-manifest.json structural integrity
│
├── fixtures/
│   ├── greenwashed-app/        # Planted defects — one per detector kind
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── canfail-manifest.json  # Planted finding IDs and expected locations
│   │   ├── src/
│   │   │   ├── index.ts        # Production entry point
│   │   │   ├── math.ts         # Source with a survivable mutation target
│   │   │   ├── utils.ts        # Contains DEMO_USER export (MOCK defect)
│   │   │   └── handler.ts      # catch block returning { ok: true } (SILENT defect)
│   │   └── tests/
│   │       ├── vacuous.test.ts # Empty test body (VACUOUS defect)
│   │       └── survived.test.ts  # Test that doesn't kill boolean-flip mutation (SURVIVED defect)
│   │
│   └── clean-app/              # A correct test suite — zero findings expected
│       ├── package.json
│       ├── src/
│       │   └── add.ts
│       └── tests/
│           └── add.test.ts
│
├── canfail.config.ts           # Example config (used by canfail running against itself)
├── package.json
├── tsconfig.json
└── README.md
```

## Naming Conventions

- Source files: `camelCase.ts`
- Test files: colocated, `camelCase.test.ts`
- All exported types: `PascalCase`
- All exported functions: `camelCase`
- Mutation kind enum values: `kebab-case` strings (`"comparison-swap"`, `"boolean-flip"`)
- Finding kind values: `SCREAMING_SNAKE_CASE` strings (`"VACUOUS"`, `"SURVIVED"`, `"MOCK"`, `"SILENT"`)

## Colocation Rule

Every `src/` module that contains logic has a `.test.ts` file **in the same directory**. No test file lives more than one directory away from the code it tests, except for integration tests in `tests/integration/` which test the assembled CLI as a whole.

## Fixture Rule

`fixtures/greenwashed-app/canfail-manifest.json` is the single source of truth for what `canfail verify-fixtures` expects to find. Any change to a planted defect requires a corresponding update to the manifest. The `tests/fixtures.test.ts` file enforces this automatically.

## Import Rules

- Detectors import from `src/ast/` and `src/types.ts` only — never from `src/report/` or `src/mutation/`
- The mutation engine imports from `src/ast/`, `src/graph/`, `src/types.ts`, and its own `src/mutation/` siblings only
- The orchestrator is the only module that imports from all other top-level modules
- `bin/canfail.ts` imports from `src/orchestrator.ts` and `src/verify-fixtures.ts` only — no direct detector imports
