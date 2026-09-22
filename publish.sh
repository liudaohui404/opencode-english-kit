#!/usr/bin/env bash
#
# Publishes this folder to a GitHub repository through the REST API.
#
#   ./publish.sh                 create/update <you>/opencode-english-kit (public)
#   ./publish.sh another-name    use a different repository name
#   ./publish.sh --private       make it private instead of public
#   ./publish.sh --dry-run       list what would be uploaded, upload nothing
#
# The repository is PUBLIC by default, so the secret scan below is the last line
# of defence: any file matching your live credentials stops the whole upload.
#
# Why the API and not `git push`: on some networks github.com:443 is blocked
# while api.github.com still answers. `git push` fails there, `gh api` works.
# Requirements: the `gh` CLI, logged in with the `repo` scope.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

REPO_NAME="opencode-english-kit"
VISIBILITY="public"
DRY=0

usage() {
  cat <<'USAGE'
Publishes this folder to a GitHub repository through the REST API.

  ./publish.sh                 create/update <you>/opencode-english-kit (public)
  ./publish.sh another-name    use a different repository name
  ./publish.sh --private       make it private instead of public
  ./publish.sh --dry-run       list what would be uploaded, upload nothing

The repository is PUBLIC by default, so the secret scan is the last line of
defence: any file matching your live credentials stops the whole upload.

Why the API and not `git push`: on some networks github.com:443 is blocked
while api.github.com still answers. `git push` fails there, `gh api` works.
Requirements: the `gh` CLI, logged in with the `repo` scope.
USAGE
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --public) VISIBILITY="public" ;;
    --private) VISIBILITY="private" ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) REPO_NAME="$1" ;;
  esac
  shift
done

step() { printf '\n== %s\n' "$*"; }
say()  { printf '   %s\n' "$*"; }
die()  { printf '   error: %s\n' "$*" >&2; exit 1; }

step "Checking the GitHub CLI"
command -v gh >/dev/null 2>&1 || die "gh is not installed (https://cli.github.com)"
gh auth status >/dev/null 2>&1 || die "gh is not logged in — run: gh auth login"
OWNER="$(gh api user --jq .login)"
say "account: $OWNER"
say "repo:    $OWNER/$REPO_NAME"

mapfile -t FILES < <(find . -type f -not -path "./.git/*" -not -path "*/node_modules/*" \
  | sed 's|^\./||' | sort)
[ "${#FILES[@]}" -gt 0 ] || die "nothing to upload"
say "files:   ${#FILES[@]}"

step "Scanning for secrets"
SECRETS=()
if [ -f "$HOME/.config/opencode/lookup.key" ]; then
  SECRETS+=("$(tr -d '\n' < "$HOME/.config/opencode/lookup.key")")
fi
if [ -f "$HOME/.config/opencode/service.json" ]; then
  pw="$(sed -n 's/.*"password"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$HOME/.config/opencode/service.json")"
  [ -n "$pw" ] && SECRETS+=("$pw")
fi

FOUND=0
for file in "${FILES[@]}"; do
  case "$(basename "$file")" in
    lookup.key|service.json|.env|*.db)
      say "refusing: $file (secret or oversized)"; FOUND=1 ;;
  esac
  for secret in ${SECRETS+"${SECRETS[@]}"}; do
    if [ -n "$secret" ] && grep -qF -- "$secret" "$file"; then
      say "refusing: $file contains a live credential"; FOUND=1
    fi
  done
  if grep -qIE 'gho_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' "$file"; then
    say "refusing: $file looks like it holds a token"; FOUND=1
  fi
done
[ "$FOUND" = "0" ] || die "secret scan failed — nothing was uploaded"
say "clean: ${#SECRETS[@]} known credential(s) checked, none present"

if [ "$DRY" = "1" ]; then
  step "Dry run — would upload"
  for file in "${FILES[@]}"; do say "$file"; done
  exit 0
fi

step "Ensuring the repository exists"
set_visibility() {
  # Newer gh requires an extra flag for visibility changes; older gh rejects it.
  if gh repo edit "$OWNER/$REPO_NAME" --visibility "$1" \
       --accept-visibility-change-consequences >/dev/null 2>&1; then
    return 0
  fi
  gh repo edit "$OWNER/$REPO_NAME" --visibility "$1" >/dev/null
}

if gh api "repos/$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  current="$(gh api "repos/$OWNER/$REPO_NAME" --jq .visibility)"
  if [ "$current" = "$VISIBILITY" ]; then
    say "exists, visibility: $current"
  else
    say "exists, visibility: $current -> $VISIBILITY"
    set_visibility "$VISIBILITY"
    say "visibility changed"
  fi
else
  gh repo create "$OWNER/$REPO_NAME" "--$VISIBILITY" \
    --description "Offline word cards, Chinese translation cards, and English reply rules for OpenCode" \
    >/dev/null
  say "created a $VISIBILITY repository"
fi

if [ "$VISIBILITY" = "public" ]; then
  say "note: this repository is PUBLIC — the files listed above become visible to anyone."
fi

step "Uploading"
for file in "${FILES[@]}"; do
  sha="$(gh api "repos/$OWNER/$REPO_NAME/contents/$file" --jq .sha 2>/dev/null || true)"
  args=(-X PUT "repos/$OWNER/$REPO_NAME/contents/$file"
        -f "message=sync $file" -f "content=$(base64 -w0 "$file")")
  [ -n "$sha" ] && args+=(-f "sha=$sha")
  gh api "${args[@]}" >/dev/null
  say "$file"
done

step "Done"
say "https://github.com/$OWNER/$REPO_NAME"
say "On a new device:"
say "  git clone https://github.com/$OWNER/$REPO_NAME.git && cd $REPO_NAME && ./install.sh --with-dict"
say "  # blocked network:"
say "  gh api /repos/$OWNER/$REPO_NAME/tarball/main | tar xz && ./install.sh --with-dict"
