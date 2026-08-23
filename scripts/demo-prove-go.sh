#!/usr/bin/env bash
# canfail prove against a real Go module. Nothing TypeScript is involved except
# the binary doing the checking. Builds a throwaway repo in /tmp.
set -uo pipefail
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/bin/canfail.js"

if ! command -v go >/dev/null; then
  printf '\n  go toolchain not found, skipping the Go demo\n\n'
  exit 0
fi

REPO="$(mktemp -d)/shop"
trap 'rm -rf "$(dirname "$REPO")"' EXIT
mkdir -p "$REPO"
cd "$REPO"

cat > go.mod <<'EOF'
module example.com/shop

go 1.21
EOF

cat > discount.go <<'EOF'
package shop

// Off by one: a basket of exactly 100 gets no discount.
func DiscountFor(total int) int {
	if total > 100 {
		return 10
	}
	return 0
}
EOF

git init -q && git config user.email t@example.com && git config user.name t
git add -A && git commit -qm "base: discount with a boundary bug"

cat > discount.go <<'EOF'
package shop

func DiscountFor(total int) int {
	if total >= 100 {
		return 10
	}
	return 0
}
EOF

printf '\n\033[1mGo module. Base commit has total > 100 where it should be >= 100. Now fixed.\033[0m\n'

cat > discount_test.go <<'EOF'
package shop

import "testing"

func TestDiscountOnLargeBasket(t *testing.T) {
	if got := DiscountFor(500); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
}
EOF

printf '\n\033[1mTest A: TestDiscountOnLargeBasket\033[0m\n'
if go test ./. >/dev/null 2>&1; then
  printf '  \033[32mgo test: PASS\033[0m\n'
else
  printf '  \033[31mgo test: FAIL\033[0m\n'
fi
printf '\033[2m$ canfail prove --base HEAD --test-command "go test ./{dir}"\033[0m\n'
node "$CLI" prove . --base HEAD --test-command "go test ./{dir}" -q
printf '\033[2m   exit %s\033[0m\n' "$?"

cat > discount_test.go <<'EOF'
package shop

import "testing"

func TestDiscountAtThreshold(t *testing.T) {
	if got := DiscountFor(100); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
}
EOF

printf '\n\033[1mTest B: TestDiscountAtThreshold\033[0m\n'
if go test ./. >/dev/null 2>&1; then
  printf '  \033[32mgo test: PASS\033[0m\n'
else
  printf '  \033[31mgo test: FAIL\033[0m\n'
fi
printf '\033[2m$ canfail prove --base HEAD --test-command "go test ./{dir}"\033[0m\n'
node "$CLI" prove . --base HEAD --test-command "go test ./{dir}" -q
printf '\033[2m   exit %s\033[0m\n\n' "$?"

printf 'Both Go tests pass on the branch. Only one of them would have caught the bug.\n\n'
