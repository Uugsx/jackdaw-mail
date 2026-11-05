#!/usr/bin/env bash
# Copy OTA assets for the platform that was NOT built into the current release.
# Keeps latest.yml / latest-mac.yml from the previous unified (or partial) release
# so platform-only publishes do not break the other OS updater.
#
# Usage: ota-carry-forward.sh <target-tag> <built-platform: mac|windows> [repo]

set -euo pipefail

TARGET_TAG="${1:?target tag required, e.g. v0.10.7}"
BUILT_PLATFORM="${2:?built platform required: mac or windows}"
REPO="${3:-Uugsx/jackdaw-mail}"

if [[ "$BUILT_PLATFORM" != "mac" && "$BUILT_PLATFORM" != "windows" ]]; then
  echo "ERROR: built platform must be mac or windows, got: $BUILT_PLATFORM"
  exit 1
fi

if [[ "$BUILT_PLATFORM" == "mac" ]]; then
  MARKER="latest.yml"
  PATTERNS=(
    "latest.yml"
    "*setup.exe"
    "*setup.exe.blockmap"
    "*.msi"
  )
else
  MARKER="latest-mac.yml"
  PATTERNS=(
    "latest-mac.yml"
    "*.dmg"
    "*.dmg.blockmap"
    "*-mac.zip"
    "*-mac.zip.blockmap"
    "*.pkg"
  )
fi

SOURCE_TAG=$(TARGET_TAG="$TARGET_TAG" MARKER="$MARKER" gh api "repos/${REPO}/releases?per_page=100" --jq '
  [.[] | select(.tag_name != env.TARGET_TAG)
   | select([.assets[].name] | index(env.MARKER) != null)
  ] | sort_by(.created_at) | reverse | .[0].tag_name // empty
')

if [[ -z "$SOURCE_TAG" ]]; then
  echo "WARN: No prior release with ${MARKER} found — skipping carry-forward."
  echo "      (First platform-only release, or no previous OTA assets.)"
  exit 0
fi

echo "Carrying ${MARKER} platform assets from ${SOURCE_TAG} → ${TARGET_TAG}"

WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

DOWNLOAD_ARGS=(gh release download "$SOURCE_TAG" --repo "$REPO" --dir "$WORKDIR")
for pattern in "${PATTERNS[@]}"; do
  DOWNLOAD_ARGS+=(--pattern "$pattern")
done

if ! "${DOWNLOAD_ARGS[@]}" 2>/dev/null; then
  echo "WARN: gh release download returned no files for ${SOURCE_TAG}"
fi

shopt -s nullglob
FILES=("$WORKDIR"/*)
shopt -u nullglob

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "ERROR: No assets downloaded from ${SOURCE_TAG} for carry-forward"
  exit 1
fi

echo "Uploading ${#FILES[@]} asset(s) to ${TARGET_TAG}:"
for f in "${FILES[@]}"; do
  echo "  $(basename "$f")"
done

gh release upload "$TARGET_TAG" --repo "$REPO" --clobber "${FILES[@]}"

echo "Carry-forward done."
