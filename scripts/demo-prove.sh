#!/usr/bin/env bash
# Builds a throwaway git repo in /tmp and runs `canfail prove` against it twice:
# once with a test that earns its place, once with a test that does not.
# Nothing outside the temp directory is touched.
set -uo pipefail
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/bin/canfail.js"
REPO="$(mktemp -d)/shop"
trap 'rm -rf "$(dirname "$REPO")"' EXIT

mkdir -p "$REPO/src"
cd "$REPO"

cat > src/discount.js <<'EOF'
export function discountFor(total) {
  // Off by one: a basket of exactly 100 gets no discount.
  return total > 100 ? 10 : 0;
}
EOF

git init -q && git config user.email t@example.com && git config user.name t
git add -A && git commit -qm "base: discount with a boundary bug"

printf '\n\033[1mBase commit has a boundary bug: total > 100 should be >= 100.\033[0m\n'
printf '\033[2mNow we fix it, and write a test alongside the fix.\033[0m\n\n'

cat > src/discount.js <<'EOF'
export function discountFor(total) {
  return total >= 100 ? 10 : 0;
}
EOF

# --- the test a hurried author (or an agent) writes ---
cat > src/discount.test.js <<'EOF'
import { test } from "node:test";
import assert from "node:assert";
import { discountFor } from "./discount.js";

test("gives the discount on a large basket", () => {
  assert.strictEqual(discountFor(500), 10);
});
EOF

printf '\033[1mTest A: "gives the discount on a large basket" — it passes on the branch.\033[0m\n'
node --test src/discount.test.js 2>&1 | tail -3
printf '\n\033[2m$ canfail prove --base HEAD\033[0m\n'
node "$CLI" prove . --base HEAD --test-command "node --test" -q
printf '\033[2m   exit %s\033[0m\n' "$?"

# --- the test that actually pins the fix ---
cat > src/discount.test.js <<'EOF'
import { test } from "node:test";
import assert from "node:assert";
import { discountFor } from "./discount.js";

test("gives the discount exactly at the threshold", () => {
  assert.strictEqual(discountFor(100), 10);
});
EOF

printf '\n\033[1mTest B: "gives the discount exactly at the threshold" — also passes on the branch.\033[0m\n'
node --test src/discount.test.js 2>&1 | tail -3
printf '\n\033[2m$ canfail prove --base HEAD\033[0m\n'
node "$CLI" prove . --base HEAD --test-command "node --test" -q
printf '\033[2m   exit %s\033[0m\n\n' "$?"

printf 'Both tests are green on the branch. Every CI in the world accepts both.\n'
printf 'Only one of them would have caught the bug.\n\n'
