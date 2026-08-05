#!/usr/bin/env bash
#
# Make Chromium runnable in this sandbox, so the site can actually be looked at.
#
# The problem: Playwright's Chromium needs eight system libraries that are not
# installed, and there is no root access, so `apt install` is impossible. For a
# long time this meant every visual decision was reasoned rather than observed.
#
# The fix: Debian packages are just ar archives. `dpkg-deb -x` unpacks one into
# any directory without touching the system, and the dynamic loader will use
# them if LD_LIBRARY_PATH points there. No root, no install.
#
# Run once per fresh sandbox:
#
#   bash _for-myself/tools/setup-browser.sh
#
# Then, for anything that launches a browser:
#
#   export LD_LIBRARY_PATH=$HOME/.localroot/root/usr/lib/x86_64-linux-gnu
#   node _for-myself/tools/shot.mjs
#
set -euo pipefail

PREFIX="$HOME/.localroot"
MIRROR="http://ftp.us.debian.org/debian/pool/main"
mkdir -p "$PREFIX/root"
cd "$PREFIX"

# pool directory, package name. Discovered by running `ldd` on the browser
# binary and resolving each "not found" line, one at a time.
PKGS=(
  "n/nspr           libnspr4"
  "n/nss            libnss3"
  "a/at-spi2-core   libatk1.0-0t64"
  "a/at-spi2-core   libatk-bridge2.0-0t64"
  "a/at-spi2-core   libatspi2.0-0t64"
  "libx/libxdamage  libxdamage1"
  "libx/libxkbcommon libxkbcommon0"
  "libx/libxres     libxres1"
  "a/alsa-lib       libasound2t64"
)

for entry in "${PKGS[@]}"; do
  read -r dir pkg <<<"$entry"
  # Pick the newest build of each package from the pool index.
  file=$(curl -s "$MIRROR/$dir/" | grep -o "${pkg}_[^\"]*amd64\.deb" | sort -u | tail -1 || true)
  if [ -z "$file" ]; then
    echo "MISS  $pkg (not found in $dir)" >&2
    continue
  fi
  if [ ! -f "$file" ]; then
    echo "GET   $file"
    curl -sO "$MIRROR/$dir/$file"
  fi
  dpkg-deb -x "$file" root/
done

# The browser itself. Pinned: the shot tool hardcodes this revision's path.
cd - >/dev/null
npx --yes playwright-core@1.49.1 install chromium >/dev/null 2>&1 || true

# The driver library, kept OUTSIDE the project. The app uses pnpm's symlinked
# node_modules; running `npm install` inside it corrupts that layout, and pnpm
# wipes the package on the next install anyway. Neither can break the other
# from here.
if [ ! -d "$HOME/pwtool/node_modules/playwright-core" ]; then
  mkdir -p "$HOME/pwtool"
  (cd "$HOME/pwtool" && npm install playwright-core@1.49.1 >/dev/null 2>&1) || true
fi

SHELL_BIN="$HOME/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell"
export LD_LIBRARY_PATH="$PREFIX/root/usr/lib/x86_64-linux-gnu"

echo
if ldd "$SHELL_BIN" 2>&1 | grep -q "not found"; then
  echo "STILL MISSING:"
  ldd "$SHELL_BIN" 2>&1 | grep "not found"
  echo
  echo "Resolve each one by finding its package at https://packages.debian.org"
  echo "and adding it to PKGS above."
  exit 1
fi

echo "All libraries resolved. $("$SHELL_BIN" --version 2>/dev/null | head -1)"
echo
echo "Now:  export LD_LIBRARY_PATH=$PREFIX/root/usr/lib/x86_64-linux-gnu"
