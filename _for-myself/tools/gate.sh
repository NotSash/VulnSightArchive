#!/usr/bin/env bash
#
# The verification gate, split so no single step can blow the response window.
#
# The problem this solves: `next build` chained with the integration suite took
# 200 seconds and timed out a whole turn's work. Two separate causes:
#
#   1. This box has 1.98 GB of RAM. Next.js spawns one worker per core for
#      static generation and type checking, and on 2 cores that peaks well
#      above what is free, so the build swaps and crawls.
#   2. Every step was run in one chained command, so a slow build also took
#      the tests, the lint and the type check down with it.
#
# Fixes applied here:
#   - `NEXT_TELEMETRY_DISABLED` so nothing phones home mid-build
#   - `--max-old-space-size=1536` to keep V8 under the ceiling rather than
#     letting it discover the limit by being killed
#   - `experimentalBuildMode=compile` skips static page generation, which is
#     the slowest phase and is not what we are verifying
#   - every step logs to a file and prints only its verdict, so a long build
#     cannot flood the response
#   - each step is separately invocable, so a timeout costs one step
#
# Usage:
#   bash _for-myself/tools/gate.sh deps     restore node_modules if wiped
#   bash _for-myself/tools/gate.sh lint     biome
#   bash _for-myself/tools/gate.sh types    tsc --noEmit
#   bash _for-myself/tools/gate.sh test     unit tests (excludes api)
#   bash _for-myself/tools/gate.sh e2e      browser tests (starts its own server)
#   bash _for-myself/tools/gate.sh api      integration tests
#   bash _for-myself/tools/gate.sh build    next build, memory capped
#   bash _for-myself/tools/gate.sh quick    lint + types + test
#   bash _for-myself/tools/gate.sh all      everything, in order
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
LOG=/tmp/gate
mkdir -p "$LOG"

export NEXT_TELEMETRY_DISABLED=1
export CI=1

step() {
  local name="$1"; shift
  local file="$LOG/$name.log"
  local start
  start=$(date +%s)
  if "$@" > "$file" 2>&1; then
    echo "  PASS  $name  ($(( $(date +%s) - start ))s)"
    return 0
  fi
  echo "  FAIL  $name  ($(( $(date +%s) - start ))s)   see $file"
  tail -25 "$file"
  return 1
}

deps() {
  if [ -d node_modules/next ]; then
    echo "  SKIP  deps (already present)"
    return 0
  fi
  # node_modules is wiped by workspace snapshots, so this is routine.
  step deps npx --yes pnpm@10.14.0 install --frozen-lockfile
}

lint()  { step lint  npx biome check . ; }
types() { step types npx tsc --noEmit ; }
test_()  { step test  npx vitest run --exclude tests/api.test.ts --reporter=dot ; }
api()   { step api   npx vitest run tests/api.test.ts --reporter=dot ; }

# Browser tests. Playwright starts and stops its own dev server, so nothing
# needs to be running first. The executable path is set because this sandbox
# provisions Chromium by hand; elsewhere Playwright finds its own.
e2e() {
  step e2e env \
    LD_LIBRARY_PATH="$HOME/.localroot/root/usr/lib/x86_64-linux-gnu" \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$HOME/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell" \
    npx playwright test
}

build() {
  # Cap the heap below the 1.98 GB the box actually has, and skip static
  # generation: it is the slowest phase and adds nothing to a correctness
  # check that tsc has already made.
  step build env NODE_OPTIONS=--max-old-space-size=1536 \
    npx next build --experimental-build-mode compile
}

case "${1:-all}" in
  deps)  deps ;;
  lint)  lint ;;
  types) types ;;
  test)  test_ ;;
  api)   api ;;
  e2e)   e2e ;;
  build) build ;;
  quick) deps && lint && types && test_ ;;
  # `e2e` runs after `build` so a compile error fails fast and cheaply rather
  # than after a browser has been launched.
  all)   deps && lint && types && test_ && api && build && e2e ;;
  *) echo "usage: gate.sh {deps|lint|types|test|api|e2e|build|quick|all}"; exit 2 ;;
esac
