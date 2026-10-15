#!/usr/bin/env bash
# Запускать из каталога mobile/.

set -Eeuo pipefail

export NODE_OPTIONS="--max-old-space-size=32768"

BUILD_FILE="../app/logic/build.ts"
BUILD_BACKUP="$(mktemp)"
cp "$BUILD_FILE" "$BUILD_BACKUP"

restore_build_file() {
  cp "$BUILD_BACKUP" "$BUILD_FILE"
  rm -f "$BUILD_BACKUP"
  unset NODE_OPTIONS
}

trap restore_build_file EXIT

# Setup mobile UI
perl -p -i \
  -e "s|isMobile = false;$|isMobile = true;|;" \
  "$BUILD_FILE"

# Build and copy assets
(cd ../app && npm run build)
rm -rf ./dist
mkdir -p ./dist
(cd ../app && cp -R ./dist/* ../mobile/dist)
(cd backend && npm run build)
npx cap copy

npx @capacitor/assets generate --android
npx @capacitor/assets generate --ios
