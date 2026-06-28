#!/usr/bin/env bash
#
# refresh-10x-skills.sh
#
# Install/refresh all currently-unlocked 10xDevs skills into the USER-LEVEL
# Claude Code skills dir (~/.claude/skills), so they are available across every
# project — not just the one you ran `10x get` in. As an additional step it also
# copies the same skills into the CURRENT PROJECT's Claude Code skills dir
# (<git-root-or-cwd>/.claude/skills), so the project you're standing in gets the
# full unlocked set too. Pass --no-project to install at user level only.
#
# Why this exists:
#   `10x get <ref>` writes skills into the PROJECT (./.claude/skills) for the
#   active tool profile, and its lesson-switching cleanup wipes skills from the
#   previously-fetched lesson. To collect skills from ALL lessons at user level
#   without that cleanup clobbering each other (or polluting a real project),
#   we fetch each lesson into its own throwaway temp dir and copy only the
#   skill folders up to ~/.claude/skills.
#
# What it does NOT install at user level: lesson rules blocks (CLAUDE.md
# guidance), prompts, or config templates — skills only, by design.
#
# Caveat: because this bypasses the normal in-place `10x get` flow, the CLI's
# manifest/sentinel tracking does not know about the user-level copy. Re-run
# this script to update; the CLI won't manage ~/.claude/skills for you.
#
# Usage:
#   scripts/refresh-10x-skills.sh               # user-level + current project
#   scripts/refresh-10x-skills.sh --no-project  # user-level only (skip project copy)
#   scripts/refresh-10x-skills.sh --dry-run     # show what would happen, copy nothing
#
set -euo pipefail

CLI="@przeprogramowani/10x-cli@latest"
DEST="$HOME/.claude/skills"
DRY_RUN=0
COPY_PROJECT=1

# Resolve the "current project" root (git top-level if we're in a repo, else the
# cwd) and target its Claude Code skills dir. This is the *project-level*
# destination, distinct from the user-level $DEST above.
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -z "$PROJECT_ROOT" ]] && PROJECT_ROOT="$PWD"
PROJECT_DEST="$PROJECT_ROOT/.claude/skills"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-project) COPY_PROJECT=0 ;;
    *) echo "error: unknown option '$arg'" >&2; exit 1 ;;
  esac
done

# Run from $HOME (or any dir whose project root is $HOME) and the two
# destinations collapse onto one — copy once, skip the redundant project pass.
[[ "$PROJECT_DEST" == "$DEST" ]] && COPY_PROJECT=0

# The set of dirs each skill is copied into.
DESTS=("$DEST")
[[ $COPY_PROJECT -eq 1 ]] && DESTS+=("$PROJECT_DEST")

run_cli() { npx -y "$CLI" "$@" 2>/dev/null; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not found" >&2; exit 1; }
}
require npx
require jq

echo "Checking auth..."
if ! run_cli auth --status | jq -e '.data.is_valid == true' >/dev/null 2>&1; then
  echo "error: not signed in to 10x-cli. Run:  npx -y $CLI auth" >&2
  exit 1
fi

echo "Discovering unlocked lessons..."
# Unlocked module numbers
modules=$(run_cli list | jq -r '.data.modules[] | select(.state=="unlocked") | .module')

refs=()
for m in $modules; do
  # Lesson ids for this module (e.g. m1l1, m1l2, ...)
  while IFS= read -r lid; do
    [[ -n "$lid" ]] && refs+=("$lid")
  done < <(run_cli list "m$m" | jq -r '.data.lessons[].lessonId')
done

if [[ ${#refs[@]} -eq 0 ]]; then
  echo "No unlocked lessons found." >&2
  exit 1
fi

echo "Unlocked lessons: ${refs[*]}"
echo "User-level destination:    $DEST"
if [[ $COPY_PROJECT -eq 1 ]]; then
  echo "Project-level destination: $PROJECT_DEST"
else
  echo "Project-level copy:        skipped"
fi
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — no files will be copied)"
echo

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
if [[ $DRY_RUN -eq 0 ]]; then
  for dst in "${DESTS[@]}"; do mkdir -p "$dst"; done
fi

total=0
for ref in "${refs[@]}"; do
  d="$STAGE/$ref"
  mkdir -p "$d"
  # Each lesson fetched in isolation so lesson-switching cleanup can't clobber.
  ( cd "$d" && npx -y "$CLI" get "$ref" >/dev/null 2>&1 ) || {
    echo "$ref: fetch failed (skipped)"; continue;
  }
  if [[ -d "$d/.claude/skills" ]]; then
    n=$(find "$d/.claude/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
    if [[ $DRY_RUN -eq 0 ]]; then
      for dst in "${DESTS[@]}"; do
        cp -R "$d/.claude/skills/." "$dst/"
      done
    fi
    total=$((total + n))
    echo "$ref: $n skill(s)"
  else
    echo "$ref: no skills"
  fi
done

echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run complete. Would refresh ~$total skill copies into each of:"
  for dst in "${DESTS[@]}"; do echo "  - $dst"; done
else
  for dst in "${DESTS[@]}"; do
    installed=$(find "$dst" -mindepth 1 -maxdepth 1 -type d -name '10x-*' | wc -l | tr -d ' ')
    echo "Done. $installed '10x-*' skills now in $dst"
  done
fi
