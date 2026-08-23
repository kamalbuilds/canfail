#!/usr/bin/env bash
# Regenerates the terminal screenshots in docs/img from real command runs.
# Requires charmbracelet/freeze:  go install github.com/charmbracelet/freeze@latest
#
# Every image in the README is produced by this script from a live run. None of
# them are hand-edited, which is the same standard the tool holds code to.
set -uo pipefail
cd "$(dirname "$0")/.."

FREEZE="${FREEZE:-$HOME/.local/bin/freeze}"
command -v "$FREEZE" >/dev/null 2>&1 || FREEZE="freeze"
if ! command -v "$FREEZE" >/dev/null 2>&1; then
  echo "freeze not found: go install github.com/charmbracelet/freeze@latest" >&2
  exit 1
fi

mkdir -p docs/img

shot() {
  local out="$1" cmd="$2"
  "$FREEZE" \
    --execute "./scripts/_shot.sh '$cmd'" \
    --execute.timeout 5m \
    --output "docs/img/$out" \
    --window \
    --border.radius 8 \
    --shadow.blur 22 \
    --shadow.y 8 \
    --padding 24 \
    --margin 24 \
    --font.size 14 \
    2>&1 | tail -1
}

shot scan.png            "node dist/bin/canfail.js scan fixtures/greenwashed-app -q"
shot prove.png           "./scripts/demo-prove.sh"
shot prove-go.png        "./scripts/demo-prove-go.sh"
shot gate-can-fail.png   "./scripts/prove-gate-can-fail.sh"
shot verify-fixtures.png "node dist/bin/canfail.js verify-fixtures fixtures/greenwashed-app --no-mutate"
shot clean.png           "node dist/bin/canfail.js scan fixtures/clean-app -q"

ls -la docs/img/
