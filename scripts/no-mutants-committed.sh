#!/usr/bin/env bash
# Fails when a mutation artifact has been committed.
#
# This check exists because it already happened here: a capture tool SIGKILLed a
# probe, the signal handlers never ran, and `containsAllergen` shipped a commit
# returning "__canfail_sentinel__". Nothing caught it until CI failed for an
# unrelated-looking reason three commits later.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# The sentinel legitimately appears in the mutant catalogue, its tests, and prose.
if git grep -n -- "__canfail_sentinel__" \
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
