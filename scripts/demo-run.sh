#!/usr/bin/env bash
# Terminal track for the demo video. Hit record, run this, narrate over it.
# Each beat pauses so narration has room. PAUSE=0 ./scripts/demo-run.sh to run flat out.
set -uo pipefail
cd "$(dirname "$0")/.."

PAUSE="${PAUSE:-4}"
beat() { printf '\n\033[1m%s\033[0m\n\n' "$1"; sleep 1; }
pause() { sleep "$PAUSE"; }
run() { printf '\033[2m$ %s\033[0m\n' "$*"; "$@"; }

clear
beat "1. The suite is green. All of it."
run npx vitest run --root fixtures/greenwashed-app 2>&1 | tail -8
pause

beat "2. Green does not mean the tests can go red."
run node dist/bin/canfail.js scan fixtures/greenwashed-app
pause

beat "3. canfail prove: the check no CI runs."
./scripts/demo-prove.sh
pause

beat "4. Same invariant, a Go module. Only the checker is TypeScript."
./scripts/demo-prove-go.sh
pause

beat "5. Real-repository proof: two generated Python tests using KiroCrew behavior."
run ./scripts/demo-prove-kirocrew.sh
pause

beat "6. Fixture exactness: find all 13 planted defects and nothing else."
run node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app
pause

beat "7. Prove the gate itself can fail: break a detector, expect red, restore, expect green."
run ./scripts/prove-gate-can-fail.sh
pause

beat "8. Crash recovery: SIGKILL the probe, confirm the tree is dirty, repair it."
printf '  SIGKILLing a real probe mid-mutation, then recovering from the crash journal.\n\n'
run npx vitest run tests/integration/crash-recovery.test.ts --reporter=verbose 2>&1 | grep -E "crash recovery|repairs|clears|Test Files|Tests" | head -12
pause

beat "9. Specified before written. The specs and hooks are in the repo."
run ls -1 .kiro/specs/vacuity-detection .kiro/specs/unearned-tests
printf '\n'
run cat .kiro/hooks/verify-fixtures-on-detector-change.json | grep -E '"name"|"trigger"|"matcher"'
printf '\n'
run grep -c "SHALL" .kiro/specs/vacuity-detection/requirements.md
printf '  ^ EARS acceptance criteria in requirements.md\n'
pause

beat "10. 78 tests. canfail scans canfail."
run npx vitest run 2>&1 | tail -4
printf '\n'
run node dist/bin/canfail.js scan . --exclude fixtures --no-mutate
printf '\n  The first self-scan found 6 surviving mutants in this suite and 1 swallowed\n'
printf '  error in the import graph. All fixed. That is the tool working on its author.\n\n'
