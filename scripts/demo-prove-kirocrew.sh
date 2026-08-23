#!/usr/bin/env bash
# canfail prove using behavior from a real KiroCrew function. Everything runs in /tmp.
#
# Source reference: JohnCrickett/KiroCrew@98e5150, forked from kirodotdev/KiroCrew,
# src/kiro_crew/knowledge/chunker.py (Apache-2.0). The tiny _word_count behavior is
# adapted for this demo. should_split, its boundary bug, and both tests are synthetic.
# This is not a scan of KiroCrew's test suite and does not claim an upstream defect.
set -euo pipefail
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/bin/canfail.js"

fail() { printf '\n  KiroCrew demo failed: %s\n\n' "$*" >&2; exit 2; }
command -v python3 >/dev/null || fail "python3 is required"
python3 -m pytest --version >/dev/null 2>&1 || fail "pytest is required"
[ -f "$CLI" ] || fail "built CLI not found; run npm run build"

REPO="$(mktemp -d)/kirocrew-chunker"
trap 'rm -rf "$(dirname "$REPO")"' EXIT
mkdir -p "$REPO"
cd "$REPO"

cat > chunker.py <<'EOF'
"""Demo adapted from JohnCrickett/KiroCrew@98e5150 (Apache-2.0).
should_split and its boundary bug are synthetic, not an upstream defect."""

def _word_count(text: str) -> int:
    return int(len(text.split()) * 1.3)

CHUNK_TOKEN_SIZE = 800

def should_split(text: str, limit: int = CHUNK_TOKEN_SIZE) -> bool:
    return _word_count(text) > limit  # synthetic bug: should be >=
EOF

git init -q && git config user.email demo@canfail.local && git config user.name canfail-demo
git add -A && git commit -qm "base: synthetic boundary bug"

printf '\n\033[1mReal-repository proof: JohnCrickett/KiroCrew@98e5150\033[0m\n'
printf '\033[2mUses its _word_count behavior. Synthetic wrapper and tests only; not a scan or upstream finding.\033[0m\n'
printf '\033[2mFix > to >=, then compare two agent-generated tests.\033[0m\n'

python3 - <<'PY'
from pathlib import Path
p = Path("chunker.py")
p.write_text(p.read_text().replace("> limit  # synthetic", ">= limit  # synthetic"))
PY

cat > test_chunker.py <<'EOF'
from chunker import should_split

def test_large_text_splits():
    big = " ".join(["word"] * 1000)
    assert should_split(big) is True
EOF

git add -A && git commit -qm "fix: boundary plus generated test"

printf '\n\033[1mTest A: well above the boundary\033[0m\n'
python3 -m pytest test_chunker.py -q 2>&1 | tail -1
printf '\033[2m$ canfail prove --base HEAD~1 --test-command "python3 -m pytest {file} -q"\033[0m\n'
set +e
node "$CLI" prove . --base HEAD~1 --test-command "python3 -m pytest {file} -q" -q
STATUS_A=$?
set -e
printf '   \033[2mexit %s\033[0m\n' "$STATUS_A"
[ "$STATUS_A" -eq 1 ] || fail "Test A should be UNEARNED with exit 1, got $STATUS_A"

cat > test_chunker.py <<'EOF'
from chunker import should_split

def test_splits_at_exact_threshold():
    at_limit = " ".join(["word"] * 616)  # int(616 * 1.3) == 800
    assert should_split(at_limit, limit=800) is True
EOF

git add test_chunker.py && git commit --amend -qm "fix: boundary plus generated test"

printf '\n\033[1mTest B: exactly on the boundary\033[0m\n'
python3 -m pytest test_chunker.py -q 2>&1 | tail -1
printf '\033[2m$ canfail prove --base HEAD~1 --test-command "python3 -m pytest {file} -q"\033[0m\n'
set +e
node "$CLI" prove . --base HEAD~1 --test-command "python3 -m pytest {file} -q" -q
STATUS_B=$?
set -e
printf '   \033[2mexit %s\033[0m\n\n' "$STATUS_B"
[ "$STATUS_B" -eq 0 ] || fail "Test B should be EARNED with exit 0, got $STATUS_B"

printf 'Both tests pass after the change. Only the boundary test would have caught it.\n\n'
