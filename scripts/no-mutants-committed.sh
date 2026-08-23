#!/usr/bin/env bash
# Fails when a mutation artifact has been committed.
#
# This check exists because it already happened here: a capture tool SIGKILLed a
# probe, the signal handlers never ran, and `containsAllergen` was committed
# returning the return-sentinel value. Nothing caught it until CI failed for an
# unrelated-looking reason three commits later.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# Assembled at runtime so this file does not itself contain the literal it hunts
# for. The first version of this check failed against its own source.
NEEDLE="__canfail""_sentinel__"

# The sentinel legitimately appears in the mutant catalogue, its tests, and prose.
if git grep -n -- "$NEEDLE" \
    ':!src/mutation/mutants.ts' \
    ':!src/mutation/mutants.test.ts' \
    ':!tests/' \
    ':!*.md' \
    ':!.kiro/' > /tmp/canfail-sentinel-hits 2>/dev/null; then
  echo "committed mutation artifact:"
  cat /tmp/canfail-sentinel-hits
  fail=1
fi

if git ls-files | grep -E '\.canfail-hidden$|^\.canfail-journal\.json$|^\.canfail-backup/'; then
  echo "committed crash-journal artifact"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "  no mutation artifacts committed"
fi
exit "$fail"
