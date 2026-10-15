# Run from app/build/ directory
# Syncs version into build.ts and package metadata; branding is Jackdaw Mail.
VERSION=`grep "\"version\"" ../../app/package.json | sed -e "s|^.*\"version\": \"||" -e "s|\",$||"`
if [ -n "${OTA_BUILD_SUFFIX:-}" ]; then
  BASE=$(echo "$VERSION" | sed 's/-dev.*//')
  VERSION="${BASE}-dev.${OTA_BUILD_SUFFIX}"
  perl -p -i -e "s|\"version\": \".*\"|\"version\": \"$VERSION\"|;" ../package.json
fi
echo Building Jackdaw Mail version $VERSION

perl -p -i \
  -e "s|production = false|production = true|;" \
  -e "s|appName: string = '.*';|appName: string = 'Jackdaw Mail';|;" \
  -e "s|siteRoot: string = '.*';|siteRoot: string = 'https://jackdaw-mail.pro';|;" \
  -e "s|appVersion: string = '.*';\$|appVersion: string = '$VERSION';|;" \
  ../logic/build.ts

perl -p -i \
  -e "s|\"name\": \".*\"|\"name\": \"jackdaw-mail\"| if \$. < 5;" \
  -e "s|\"version\": \".*\"|\"version\": \"$VERSION\"|;" \
  ../../desktop/package.json

perl -p -i \
  -e "s|\"name\": \".*\"|\"name\": \"jackdaw-mail\"| if \$. < 5;" \
  -e "s|\"version\": \".*\"|\"version\": \"$VERSION\"|;" \
  ../../mobile/package.json

perl -p -i \
  -e "s|\"version\": \".*\"|\"version\": \"$VERSION\"|;" \
  ../package.json

perl -p -i \
  -e "s|versionName \".*\"|versionName \"$VERSION\"|;" \
  ../../mobile/android/app/build.gradle

MARKETING_VERSION=$(echo "$VERSION" | sed 's/-.*//')
MAJOR_MINOR=$(echo "$VERSION" | sed 's/^\([0-9]*\.[0-9]*\).*/\1/')
BUILD_VERSION="${MAJOR_MINOR}.$(date +%Y%m%d%H%M%S)"
echo Setting iOS Build Version to $BUILD_VERSION
perl -p -i \
  -e "s|MARKETING_VERSION = .*|MARKETING_VERSION = \"$MARKETING_VERSION\";|;" \
  -e "s|CURRENT_PROJECT_VERSION = .*|CURRENT_PROJECT_VERSION = $BUILD_VERSION;|;" \
  ../../mobile/ios/App/App.xcodeproj/project.pbxproj

# Ensure Jackdaw icons are in place
perl -MFile::Path -e "mkpath('../../mobile/assets')"
if [ -f ../../desktop/build/icon-jackdaw.png ]; then
  perl -MFile::Copy -e "copy('../../desktop/build/icon-jackdaw.png', '../../desktop/build/icon.png')"
  perl -MFile::Copy -e "copy('../../desktop/build/icon-jackdaw.png', '../../mobile/assets/icon.png')"
fi

echo Jackdaw Mail brand sync done.

mkdir -p ../../desktop/build
if [ -n "${JACKDAW_GH_UPDATE_TOKEN:-}" ]; then
  printf '%s' "$JACKDAW_GH_UPDATE_TOKEN" > ../../desktop/build/gh-update-token.txt
else
  : > ../../desktop/build/gh-update-token.txt
fi
if [ ! -s ../../desktop/build/gh-update-token.txt ]; then
  echo "WARN: gh-update-token.txt is empty (OK for public GitHub repo OTA)."
fi

if command -v rg >/dev/null 2>&1; then
  if rg -i "parula|mustang" ../.. --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/package-lock.json' --glob '!**/yarn.lock' -q; then
    echo "ERROR: forbidden legacy brand name found in the repository (Parula/Mustang)"
    exit 1
  fi
fi
