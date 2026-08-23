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
run npx vitest run --root fixtures/greenwashed-app
pause

beat "2. Green does not mean the tests can go red."
run node dist/bin/canfail.js scan fixtures/greenwashed-app
pause

beat "3. The one that matters: verdictFor decides if a food product is safe for an allergy."
run sed -n '14,26p' fixtures/greenwashed-app/src/scoring.ts
printf '\n  canfail inverted that comparison, re-ran the suite, and the suite stayed green.\n'
printf '  The only test that approached the threshold was it.skip.\n'
pause

beat "4. And the check no CI runs: a new test must fail against the code it predates."
./scripts/demo-prove.sh
pause

beat "5. A scanner that prints zero is indistinguishable from a broken scanner."
run node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app --no-mutate
pause

beat "6. So prove the gate itself can fail: break a detector, expect red, restore, expect green."
run ./scripts/prove-gate-can-fail.sh
pause

beat "7. Built spec-first. The specs are in the repo."
run ls -1 .kiro/specs/vacuity-detection .kiro/steering .kiro/hooks
printf '\n'
run grep -n "SHALL" .kiro/specs/vacuity-detection/requirements.md
pause

beat "8. And canfail scans canfail."
run npx vitest run
run node dist/bin/canfail.js scan . --exclude fixtures --no-mutate
printf '\n  The first self-scan found 6 surviving mutants in this suite and 1 swallowed\n'
printf '  error in the import graph. All fixed. That is the tool working on its author.\n\n'
