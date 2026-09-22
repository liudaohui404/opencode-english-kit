#!/usr/bin/env bash
#
# One-key installer for this English-learning setup.
#
# It installs two things into ~/.config/opencode:
#   1. the `lookup` TUI plugin  — offline word cards + Chinese translation cards
#   2. the reply-style rules    — AGENTS.md (English replies with Chinese glosses)
#
# Usage:
#   ./install.sh                    copy the files into ~/.config/opencode
#   ./install.sh --link             symlink them instead (updates via git pull)
#   ./install.sh --with-dict        also build the offline dictionary (~327 MB)
#   ./install.sh --key sk-xxxx      store your translation API key
#   ./install.sh --config-dir DIR   install somewhere else (for testing)
#
# The default is copy mode: the installed files are independent of this repo,
# so deleting or moving the repo cannot break your OpenCode config.
# Anything it replaces is first moved to ~/.config/opencode/.backup-<timestamp>/.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO_DIR/opencode"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="copy"
WITH_DICT=0
KEY="${OPENCODE_LOOKUP_KEY:-}"

usage() {
  sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy" ;;
    --link) MODE="link" ;;
    --with-dict) WITH_DICT=1 ;;
    --key) shift; KEY="${1:-}" ;;
    --config-dir) shift; CONFIG_DIR="${1:?--config-dir needs a value}" ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  shift
done

step() { printf '\n== %s\n' "$*"; }
say()  { printf '   %s\n' "$*"; }
die()  { printf '   error: %s\n' "$*" >&2; exit 1; }

[ -d "$SRC" ] || die "cannot find $SRC — run this script from the repository"
[ -f "$SRC/AGENTS.md" ] || die "cannot find $SRC/AGENTS.md"

step "Checking the environment"
say "repository: $REPO_DIR"
say "config dir: $CONFIG_DIR"
if command -v opencode >/dev/null 2>&1; then
  say "opencode:   $(command -v opencode)"
else
  say "warning: 'opencode' is not on PATH. Install OpenCode first, then re-run."
fi
RUNNER=""
MERGER=""
for candidate in node bun; do
  if command -v "$candidate" >/dev/null 2>&1; then
    RUNNER="$candidate"; MERGER="$REPO_DIR/scripts/merge-cli.mjs"; break
  fi
done
if [ -z "$RUNNER" ] && command -v python3 >/dev/null 2>&1; then
  RUNNER="python3"; MERGER="$REPO_DIR/scripts/merge-cli.py"
fi
say "json merge: ${RUNNER:-(none found)}"
say "bun:        $(command -v bun >/dev/null 2>&1 && command -v bun || echo '(not found)')"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$CONFIG_DIR/.backup-$STAMP"
mkdir -p "$CONFIG_DIR/commands" "$CONFIG_DIR/plugins"

place() {
  local src="$1" dst="$2"
  if [ "$MODE" = "link" ] && [ -L "$dst" ] && [ "$(readlink -f "$dst")" = "$(readlink -f "$src")" ]; then
    say "already linked: $dst"
    return
  fi
  # copy mode: skip when the installed copy already matches, so re-running is safe
  if [ "$MODE" = "copy" ] && [ -e "$dst" ] && [ ! -L "$dst" ]; then
    if [ -d "$src" ] && diff -r "$src" "$dst" >/dev/null 2>&1; then
      say "up to date: $dst"
      return
    fi
    if [ -f "$src" ] && cmp -s "$src" "$dst"; then
      say "up to date: $dst"
      return
    fi
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    mkdir -p "$BACKUP"
    mv "$dst" "$BACKUP/$(basename "$dst")"
    say "backed up: $dst"
  fi
  if [ "$MODE" = "link" ]; then
    ln -s "$src" "$dst"
    say "linked: $dst"
  else
    cp -r "$src" "$dst"
    say "copied: $dst"
  fi
}

step "Installing files ($MODE mode)"
place "$SRC/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
place "$SRC/commands/word.md" "$CONFIG_DIR/commands/word.md"
place "$SRC/plugins/lookup" "$CONFIG_DIR/plugins/lookup"

step "Registering the plugin in cli.json"
if [ -n "$RUNNER" ]; then
  "$RUNNER" "$MERGER" "$CONFIG_DIR/cli.json"
else
  say "no node, bun, or python3 found; add this entry to cli.json by hand:"
  say '  { "package": "./plugins/lookup", "options": {} }'
fi

step "Translation API key (optional)"
KEY_FILE="$CONFIG_DIR/lookup.key"
if [ -n "$KEY" ]; then
  printf '%s\n' "$KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  say "wrote $KEY_FILE (mode 600)"
elif [ -f "$KEY_FILE" ]; then
  chmod 600 "$KEY_FILE" 2>/dev/null || true
  say "kept the existing $KEY_FILE"
else
  say "no key given — /dict works fully offline, and /zh falls back to free services."
  say "add one later with:"
  say "  echo 'YOUR_KEY' > $KEY_FILE && chmod 600 $KEY_FILE"
fi

step "Offline dictionary"
DB="${OPENCODE_LOOKUP_DB:-$HOME/.local/share/lookup/dict.db}"
if [ -f "$DB" ]; then
  say "already present: $DB ($(du -h "$DB" | cut -f1))"
elif [ "$WITH_DICT" = "1" ]; then
  command -v bun >/dev/null 2>&1 || die "--with-dict needs bun (https://bun.sh)"
  command -v unzip >/dev/null 2>&1 || die "--with-dict needs unzip"
  say "building $DB — this downloads a ~207 MB archive, unpacks it, and takes a few minutes"
  ( cd "$SRC/plugins/lookup" && bun build-db.ts )
  say "built: $DB ($(du -h "$DB" | cut -f1))"
else
  say "not built yet. Build it with:"
  say "  ./install.sh --with-dict"
fi

step "Verifying"
if command -v bun >/dev/null 2>&1; then
  ( cd "$SRC/plugins/lookup" && bun test 2>&1 | tail -3 )
else
  say "bun not found, skipped the test run"
fi

step "Done"
say "Restart OpenCode, then try:  /dict ubiquitous   /zh hello world   /word resilient"
[ -d "$BACKUP" ] && say "Previous files were moved to $BACKUP"
exit 0
