#!/usr/bin/env bash
# Proves that canfail's own verification gate is capable of failing.
#
# A passing check is worth nothing unless breaking what it guards turns it red.
# This script breaks a detector, asserts the gate goes red, restores it, and
# asserts the gate goes green again. Run it yourself: ./scripts/prove-gate-can-fail.sh
set -uo pipefail
cd "$(dirname "$0")/.."

DETECTOR="src/detectors/vacuous.ts"
BACKUP="$(mktemp)"
trap 'cp "$BACKUP" "$DETECTOR"; npx tsc -p tsconfig.json >/dev/null 2>&1' EXIT

fail() { printf '\n  FAILED: %s\n\n' "$1"; exit 1; }

printf '\n  1. baseline: the gate should be green\n'
npx tsc -p tsconfig.json >/dev/null 2>&1 || fail "build failed"
node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app --no-mutate >/dev/null 2>&1
[ $? -eq 0 ] || fail "gate was already red before we broke anything"
printf '     exit 0, as expected\n'

printf '\n  2. breaking the skipped-test detector\n'
cp "$DETECTOR" "$BACKUP"
perl -0pi -e 's/if \(tc\.modifier === "skip" \|\| tc\.modifier === "todo" \|\| tc\.modifier === "failing"\) \{/if (false) {/' "$DETECTOR"
grep -q "if (false)" "$DETECTOR" || fail "could not apply the break; the source has changed shape"
npx tsc -p tsconfig.json >/dev/null 2>&1 || fail "build failed after the break"

node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app --no-mutate 2>/dev/null | grep -E "MISS|FAILED"
BROKEN_EXIT=${PIPESTATUS[0]}
[ "$BROKEN_EXIT" -eq 1 ] || fail "the gate stayed green with a detector disabled (exit $BROKEN_EXIT). This check cannot fail."
printf '     exit 1, the planted defect was reported as missed\n'

printf '\n  3. restoring the detector\n'
cp "$BACKUP" "$DETECTOR"
npx tsc -p tsconfig.json >/dev/null 2>&1 || fail "build failed after restore"
node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app --no-mutate >/dev/null 2>&1
RESTORED_EXIT=$?
[ "$RESTORED_EXIT" -eq 0 ] || fail "the gate stayed red after restoring (exit $RESTORED_EXIT)"
printf '     exit 0, green again\n'

printf '\n  PROVEN: green -> red -> green. The gate can fail.\n\n'
