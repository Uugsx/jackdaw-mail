#!/usr/bin/env bash
# Зеркало обновлений на VPS (jackdaw-mail.pro/updates/): копирует из релиза GitHub
# DMG, setup.exe, latest*.yml и blockmap-файлы, затем удаляет старые версии.
# GitHub остаётся источником правды: клиент берёт контрольные суммы из манифеста GitHub.
# Использование: ota-mirror-sync.sh <tag> <owner/repo>
# Окружение: MIRROR_SSH_KEY_FILE, MIRROR_KNOWN_HOSTS_FILE, MIRROR_HOST, MIRROR_USER, GH_TOKEN
set -euo pipefail

TAG="${1:?tag}"
REPO="${2:?owner/repo}"
# mac | win | all: зеркало платформы выкладывается сразу после её сборки, чтобы клиент
# не попадал в окно, когда манифест на GitHub уже есть, а файла на зеркале ещё нет
PLATFORM="${3:-all}"
KEEP="${MIRROR_KEEP_VERSIONS:-3}"

STAGE="$(mktemp -d)"
EMPTY="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$EMPTY"' EXIT

SSH="ssh -i $MIRROR_SSH_KEY_FILE -o UserKnownHostsFile=$MIRROR_KNOWN_HOSTS_FILE -o StrictHostKeyChecking=yes -o BatchMode=yes"
REMOTE="$MIRROR_USER@$MIRROR_HOST:"

case "$PLATFORM" in
  mac) PATTERNS=('*.dmg' '*.dmg.blockmap' 'latest-mac.yml') ;;
  win) PATTERNS=('*-setup.exe' '*-setup.exe.blockmap' 'latest.yml') ;;
  *) PATTERNS=('*.dmg' '*.dmg.blockmap' '*-setup.exe' '*-setup.exe.blockmap' 'latest.yml' 'latest-mac.yml') ;;
esac
for pattern in "${PATTERNS[@]}"; do
  gh release download "$TAG" --repo "$REPO" --dir "$STAGE" --pattern "$pattern" || true
done

# Пустой или недокачанный файл не должен попасть в зеркало
for f in "$STAGE"/*; do
  [ -s "$f" ] || { echo "::error::Пустой файл $f"; exit 1; }
done
ls -la "$STAGE"

# Сначала установщики и blockmap, манифесты последними: клиент не увидит версию без файла
rsync -rlt --no-perms --chmod=D755,F644 --partial --exclude='*.yml' -e "$SSH" "$STAGE/" "$REMOTE"
rsync -rlt --no-perms --chmod=D755,F644 -e "$SSH" --include='*.yml' --exclude='*' "$STAGE/" "$REMOTE"

# Храним последние $KEEP версий каждого установщика
prune() {
  local suffix="$1"
  rsync -e "$SSH" --list-only "$REMOTE" \
    | awk -v s="$suffix" '$NF ~ s"$" && $NF !~ /blockmap$/ { print $(NF-2) "T" $(NF-1), $NF }' \
    | sort -r | awk -v k="$KEEP" 'NR>k { print $2 }' \
    | while read -r old; do
        [ -n "$old" ] || continue
        echo "Удаляю старую версию $old"
        for victim in "$old" "$old.blockmap"; do
          rsync -r --delete -e "$SSH" --include="$victim" --exclude='*' "$EMPTY/" "$REMOTE"
        done
      done
}
if [ "$PLATFORM" = all ]; then
  prune '\\.dmg'
  prune '-setup\\.exe'
fi
