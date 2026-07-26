#!/usr/bin/env bash
# release-notes.sh <tag> [previous-tag]
#
# Emits the release notes for a tag on stdout: the curated CHANGELOG section for
# that version, followed by the commits it actually contains.
#
# Both halves matter, and neither substitutes for the other. The changelog is
# written for the person installing the app — it says what changed for them and
# what it was measured to do. The commit list is written by git — it says what is
# provably in the tag, and it is the half that cannot drift, because nobody
# maintains it by hand.
#
# GitHub's own --generate-notes is deliberately not used. It builds its list from
# merged pull requests, so a release cut from commits pushed straight to main
# gets a body consisting of a compare link and nothing else.
set -euo pipefail

TAG="${1:?usage: release-notes.sh <tag> [previous-tag]}"
VERSION="${TAG#v}"
PREV="${2:-}"

if [ -z "$PREV" ]; then
  # The tag before this one, by version order rather than by date: releases get
  # cut out of order often enough that date order lies.
  PREV="$(git tag --list 'v*' --sort=-version:refname | grep -A1 -x -F "$TAG" | tail -n1 || true)"
  [ "$PREV" = "$TAG" ] && PREV=""
fi

# --- curated section from the changelog -------------------------------------
# Matches "## [0.6.9]" and range headings like "## [0.6.9] - [0.6.11]".
if [ -f CHANGELOG.md ]; then
  awk -v ver="$VERSION" '
    /^## \[/ {
      if (found) exit
      # Collect every version named in the heading, so a range heading is found
      # by each version it covers.
      line = $0
      n = 0
      while (match(line, /\[[0-9]+\.[0-9]+\.[0-9]+\]/)) {
        v = substr(line, RSTART + 1, RLENGTH - 2)
        if (v == ver) n = 1
        line = substr(line, RSTART + RLENGTH)
      }
      if (n) { found = 1; print; next }
    }
    found { print }
  ' CHANGELOG.md
fi

# --- what is provably in it --------------------------------------------------
echo
echo "### Commits"
echo
if [ -n "$PREV" ]; then
  git log --no-merges --pretty='- %s (`%h`)' "$PREV..$TAG"
  echo
  echo "**Full changelog**: https://github.com/redstone-md/mosh/compare/${PREV}...${TAG}"
else
  git log --no-merges --pretty='- %s (`%h`)' "$TAG" | head -50
fi
